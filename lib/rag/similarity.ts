/**
 * RAG similarity core — pure functions, no I/O.
 * ---------------------------------------------------------------------
 * The local retrieval driver ranks chunks with exact cosine similarity
 * in-process. Separated from data loading so it is unit-testable and
 * so the pgvector driver can share the same result shape.
 */

export interface ScoredChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

export interface RankableChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
}

export interface RankOptions {
  topK?: number;
  matchThreshold?: number;
}

// Defaults preserved from ragdb's retriever.
export const DEFAULT_TOP_K = 8;
export const DEFAULT_MATCH_THRESHOLD = 0.3;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Rank chunks by cosine similarity against the query vector, drop
 * everything below the threshold, return the top-K best matches
 * sorted by similarity descending. Dimension-mismatched chunks score
 * 0 and are filtered by the threshold — a provider switch mid-life
 * can never produce garbage rankings.
 */
export function rankChunks(
  queryEmbedding: number[],
  chunks: RankableChunk[],
  options: RankOptions = {}
): ScoredChunk[] {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const matchThreshold = options.matchThreshold ?? DEFAULT_MATCH_THRESHOLD;

  return chunks
    .map((c) => ({
      id: c.id,
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      chunkIndex: c.chunkIndex,
      content: c.content,
      similarity: cosineSimilarity(queryEmbedding, c.embedding),
    }))
    .filter((c) => c.similarity >= matchThreshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}
