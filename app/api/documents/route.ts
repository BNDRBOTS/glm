/**
 * /api/documents
 * ---------------------------------------------------------------------
 * GET  — list the caller's documents (RAG library view)
 * POST — upload + ingest a document (multipart form: file, title?)
 *
 * Validation preserved from ragdb: MIME allowlist (PDF, DOCX, XLSX,
 * TXT, MD — with extension fallback for browsers that omit the MIME
 * type), 50 MB hard cap. Ingest runs parse → chunk → embed → index
 * synchronously; the response carries the final status so the client
 * needs no polling for the common case.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, ensureUserRow } from "@/lib/auth/require-user";
import { resolveMimeType } from "@/lib/rag/parsers";
import { ingestDocument, MAX_FILE_SIZE } from "@/lib/rag/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Large files + batched embedding calls take time (ported from ragdb).
export const maxDuration = 300;

export async function GET() {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  const documents = await db.document.findMany({
    where: { userId: userId! },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      filename: true,
      mimeType: true,
      fileSize: true,
      status: true,
      error: true,
      chunkCount: true,
      embeddingProvider: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    documents: documents.map((d) => ({
      ...d,
      createdAt: d.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const [userId, denied] = await requireUser();
  if (denied) return denied;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file field is required" }, { status: 400 });
  }

  const mimeType = resolveMimeType(file.name, file.type);
  if (!mimeType) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || file.name}. Allowed: PDF, DOCX, XLSX, TXT, MD` },
      { status: 422 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 413 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 422 });
  }

  const title = (formData.get("title") as string | null)?.trim() || file.name;
  const buffer = Buffer.from(await file.arrayBuffer());

  // Demo mode: materialize the synthetic user before the FK write.
  await ensureUserRow(userId!);

  let result;
  try {
    result = await ingestDocument(userId!, {
      filename: file.name,
      mimeType,
      buffer,
      title,
    });
  } catch (e) {
    // Failures before the document row exists (storage/DB) — the
    // parse/embed phase reports through result.status = "error".
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ingest failed" },
      { status: 500 }
    );
  }

  if (result.status === "error") {
    // The document row exists in "error" state so the library shows
    // what failed; the HTTP status still reflects the failure.
    return NextResponse.json(
      { error: result.error ?? "Processing failed", documentId: result.documentId },
      { status: 500 }
    );
  }

  return NextResponse.json({
    documentId: result.documentId,
    title: result.title,
    chunkCount: result.chunkCount,
    embeddingProvider: result.embeddingProvider,
    status: result.status,
  });
}
