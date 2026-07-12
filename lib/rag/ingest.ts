/**
 * RAG ingest — the full document pipeline from ragdb, on Prisma.
 * ---------------------------------------------------------------------
 *   1. Persist the original file (same storage layer as attachments).
 *   2. Create the Document row with status "processing".
 *   3. Parse (MIME-dispatched) → chunk (512/64 sliding window) →
 *      embed (batched, 256 chunks per call — ragdb's batch size).
 *   4. Insert chunks + mark the document "ready".
 *   5. On any failure: mark "error" with the reason; the original
 *      file and the row are kept so the user sees what failed.
 *
 * When the Supabase pgvector driver is configured, vectors are also
 * mirrored into the HNSW-indexed rag_chunks table (best-effort — a
 * mirror failure is audited, never fatal; local retrieval still has
 * the truth).
 */

import "@/lib/server-guard";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { storeAttachment, deleteAttachment } from "@/lib/storage/attachments";
import { parseDocument } from "./parsers";
import { chunkText } from "./chunker";
import {
  embedBatch,
  resolveEmbeddingProvider,
  EMBEDDING_DIMENSIONS,
} from "./embeddings";
import {
  resolveRagDriver,
  mirrorChunksToPgvector,
  removeDocumentFromPgvector,
} from "./retriever";

// Preserved from ragdb: 50 MB hard cap, 256-chunk embedding batches.
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
const EMBED_BATCH_SIZE = 256;

export interface IngestInput {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  title?: string;
}

export interface IngestResult {
  documentId: string;
  title: string;
  chunkCount: number;
  status: "ready" | "error";
  embeddingProvider: string;
  error?: string;
}

export async function ingestDocument(
  userId: string,
  input: IngestInput
): Promise<IngestResult> {
  if (!userId) throw new Error("ingestDocument requires a userId");
  if (input.buffer.length === 0) throw new Error("Empty file");
  if (input.buffer.length > MAX_FILE_SIZE) throw new Error("File exceeds 50 MB limit");

  const title = input.title?.trim() || input.filename;
  const provider = resolveEmbeddingProvider();

  // 1. Keep the original file.
  const stored = await storeAttachment(input.filename, input.mimeType, input.buffer);

  // 2. Document row, processing state.
  const document = await db.document.create({
    data: {
      userId,
      title,
      filename: stored.filename,
      mimeType: input.mimeType,
      fileSize: input.buffer.length,
      status: "processing",
      embeddingProvider: provider,
      embeddingDim: EMBEDDING_DIMENSIONS[provider],
      storage: stored.storage,
      storageKey: stored.storageKey,
    },
  });

  try {
    // 3. Parse → chunk → embed.
    const rawText = await parseDocument(input.buffer, input.mimeType);
    const chunks = chunkText(rawText, { maxTokens: 512, overlapTokens: 64 });

    if (chunks.length === 0) {
      throw new Error("Document produced zero chunks after parsing");
    }

    const allEmbeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const slice = chunks.slice(i, i + EMBED_BATCH_SIZE);
      const embeddings = await embedBatch(slice.map((c) => c.content), provider);
      allEmbeddings.push(...embeddings);
    }

    // 4. Persist chunks + flip to ready.
    const created: { id: string; chunkIndex: number; content: string; embedding: number[] }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const row = await db.documentChunk.create({
        data: {
          documentId: document.id,
          userId,
          chunkIndex: chunks[i].index,
          content: chunks[i].content,
          tokenCount: chunks[i].tokenCount,
          embedding: JSON.stringify(allEmbeddings[i]),
        },
        select: { id: true },
      });
      created.push({
        id: row.id,
        chunkIndex: chunks[i].index,
        content: chunks[i].content,
        embedding: allEmbeddings[i],
      });
    }

    await db.document.update({
      where: { id: document.id },
      data: { status: "ready", chunkCount: chunks.length },
    });

    // Mirror into pgvector when the accelerator is active.
    if (resolveRagDriver() === "supabase") {
      const mirrored = await mirrorChunksToPgvector(userId, document.id, title, created).catch(
        () => false
      );
      if (!mirrored) {
        await logAudit({
          userId,
          source: "rag",
          level: "warn",
          event: "rag.pgvector_mirror_failed",
          payload: { documentId: document.id, chunkCount: chunks.length },
        });
      }
    }

    await logAudit({
      userId,
      source: "rag",
      event: "document.ready",
      payload: {
        documentId: document.id,
        title,
        mimeType: input.mimeType,
        fileSize: input.buffer.length,
        chunkCount: chunks.length,
        embeddingProvider: provider,
      },
    });

    return {
      documentId: document.id,
      title,
      chunkCount: chunks.length,
      status: "ready",
      embeddingProvider: provider,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Processing failed";
    await db.document.update({
      where: { id: document.id },
      data: { status: "error", error: message.slice(0, 500) },
    });
    await logAudit({
      userId,
      source: "rag",
      level: "error",
      event: "document.error",
      payload: { documentId: document.id, title, error: message },
    });
    return {
      documentId: document.id,
      title,
      chunkCount: 0,
      status: "error",
      embeddingProvider: provider,
      error: message,
    };
  }
}

/**
 * Delete a document: chunks cascade in the DB, the stored file is
 * unlinked, and the pgvector mirror (if any) is cleaned up.
 * Ownership must be verified by the caller (route layer).
 */
export async function deleteDocument(userId: string, documentId: string): Promise<boolean> {
  const document = await db.document.findFirst({
    where: { id: documentId, userId },
    select: { id: true, storageKey: true, title: true },
  });
  if (!document) return false;

  await deleteAttachment(document.storageKey);
  await removeDocumentFromPgvector(document.id).catch(() => false);
  await db.document.delete({ where: { id: document.id } });

  await logAudit({
    userId,
    source: "rag",
    event: "document.deleted",
    payload: { documentId: document.id, title: document.title },
  });
  return true;
}
