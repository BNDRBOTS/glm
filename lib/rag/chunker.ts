/**
 * RAG — sentence-boundary sliding-window chunker.
 * ---------------------------------------------------------------------
 * Ported intact from the RAG Chat platform (ragdb). Pure TypeScript,
 * zero dependencies, deterministic.
 *
 * Defaults match the original: 512 tokens max per chunk, 64-token
 * overlap between consecutive chunks. Token counts are approximated
 * from whitespace-separated words (1 token ≈ 0.75 words).
 */

export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
}

export interface ChunkerOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

export function approxTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length / 0.75);
}

function splitSentences(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g);
  if (sentences && sentences.length > 1) return sentences;
  // Fallback for punctuation-light text: keep the whitespace as its own
  // tokens (capturing split) so the downstream join('') rebuilds the source
  // verbatim instead of welding every word together. Whitespace tokens score
  // zero in approxTokens, so windowing math is unaffected.
  return text.split(/(\s+)/).filter(Boolean);
}

export function chunkText(text: string, options: ChunkerOptions = {}): Chunk[] {
  const maxTokens = options.maxTokens ?? 512;
  const overlapTokens = options.overlapTokens ?? 64;

  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  const sentences = splitSentences(normalized);
  const chunks: Chunk[] = [];
  let windowSentences: string[] = [];
  let windowTokens = 0;
  let overlapBuffer: string[] = [];
  let chunkIndex = 0;

  for (const sentence of sentences) {
    const sentenceTokens = approxTokens(sentence);

    if (sentenceTokens > maxTokens) {
      if (windowSentences.length > 0) {
        const content = windowSentences.join("").trim();
        chunks.push({ index: chunkIndex++, content, tokenCount: windowTokens });
        overlapBuffer = buildOverlapBuffer(windowSentences, overlapTokens);
        windowSentences = [...overlapBuffer];
        windowTokens = overlapBuffer.reduce((acc, s) => acc + approxTokens(s), 0);
      }
      chunks.push({ index: chunkIndex++, content: sentence.trim(), tokenCount: sentenceTokens });
      overlapBuffer = [sentence];
      windowSentences = [...overlapBuffer];
      windowTokens = sentenceTokens;
      continue;
    }

    if (windowTokens + sentenceTokens > maxTokens && windowSentences.length > 0) {
      const content = windowSentences.join("").trim();
      chunks.push({ index: chunkIndex++, content, tokenCount: windowTokens });
      overlapBuffer = buildOverlapBuffer(windowSentences, overlapTokens);
      windowSentences = [...overlapBuffer, sentence];
      windowTokens = overlapBuffer.reduce((acc, s) => acc + approxTokens(s), 0) + sentenceTokens;
    } else {
      windowSentences.push(sentence);
      windowTokens += sentenceTokens;
    }
  }

  if (windowSentences.length > 0) {
    const content = windowSentences.join("").trim();
    if (content) {
      chunks.push({ index: chunkIndex++, content, tokenCount: windowTokens });
    }
  }

  return chunks;
}

function buildOverlapBuffer(sentences: string[], overlapTokens: number): string[] {
  const buffer: string[] = [];
  let accumulated = 0;
  for (let i = sentences.length - 1; i >= 0; i--) {
    const t = approxTokens(sentences[i]);
    if (accumulated + t > overlapTokens) break;
    buffer.unshift(sentences[i]);
    accumulated += t;
  }
  return buffer;
}
