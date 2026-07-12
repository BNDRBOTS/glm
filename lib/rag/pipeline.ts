/**
 * RAG pipeline — retrieval → numbered source excerpts → system prompt.
 * ---------------------------------------------------------------------
 * Prompt semantics preserved from ragdb: matched chunks are injected
 * as numbered [Source N] excerpts with a citation instruction; when
 * nothing matches, the model is told to answer from general knowledge
 * and say when unsure. The merged platform returns `null` for the
 * no-documents case instead of a bare fallback prompt so the chat
 * route can keep its existing system-prefix stack untouched.
 */

import "@/lib/server-guard";
import { retrieveChunks, type RetrieveOptions } from "./retriever";
import type { ScoredChunk } from "./similarity";

export interface RagSource {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  snippet: string;
  similarity: number;
}

export interface RagContext {
  chunks: ScoredChunk[];
  sources: RagSource[];
  systemPrompt: string | null;
  driver: string;
  degradedToLocal: boolean;
}

export function formatContext(chunks: ScoredChunk[]): string {
  if (chunks.length === 0) return "";
  return chunks
    .map(
      (c, i) =>
        `[Source ${i + 1} | ${c.documentTitle} | chunk:${c.chunkIndex}]\n${c.content}`
    )
    .join("\n\n---\n\n");
}

export const RAG_NO_CONTEXT_PROMPT =
  "The user has no indexed documents relevant to this question, so answer from general knowledge and say when you are unsure.";

export function buildRagSystemPrompt(chunks: ScoredChunk[]): string | null {
  const context = formatContext(chunks);
  if (!context) return null;
  return (
    "Use the following document excerpts to answer the user's question accurately. " +
    "Cite [Source N] when referencing a specific excerpt. " +
    "If the excerpts do not contain the answer, say so plainly.\n\n" +
    context
  );
}

export function toSources(chunks: ScoredChunk[]): RagSource[] {
  return chunks.map((c) => ({
    chunkId: c.id,
    documentId: c.documentId,
    documentTitle: c.documentTitle,
    chunkIndex: c.chunkIndex,
    snippet: c.content.slice(0, 200),
    similarity: Math.round(c.similarity * 1000) / 1000,
  }));
}

/**
 * Run retrieval for a user query and assemble the RAG system prompt.
 * Never throws — a retrieval failure returns an empty context so the
 * chat turn proceeds without document grounding.
 */
export async function buildRagContext(
  userId: string,
  query: string,
  options: RetrieveOptions = {}
): Promise<RagContext> {
  try {
    const result = await retrieveChunks(userId, query, options);
    return {
      chunks: result.chunks,
      sources: toSources(result.chunks),
      systemPrompt: buildRagSystemPrompt(result.chunks),
      driver: result.driver,
      degradedToLocal: result.degradedToLocal,
    };
  } catch {
    return {
      chunks: [],
      sources: [],
      systemPrompt: null,
      driver: "local",
      degradedToLocal: false,
    };
  }
}
