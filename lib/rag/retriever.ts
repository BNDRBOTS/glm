/**
 * RAG retriever — dual driver.
 * ---------------------------------------------------------------------
 *   local    (default) — exact cosine over the user's chunks straight
 *            from Prisma. Works identically on SQLite (dev) and
 *            PostgreSQL (Railway). Scales comfortably to tens of
 *            thousands of chunks per user; zero extra infrastructure.
 *
 *   supabase (optional) — ANN retrieval through the pgvector HNSW
 *            index carried over from ragdb. The ingest pipeline
 *            mirrors vectors into the `rag_chunks` table
 *            (supabase/rag/101_rag_pgvector.sql) and retrieval calls
 *            the `match_rag_chunks` RPC. Any failure falls back to
 *            the local driver — pgvector is an accelerator, never a
 *            single point of failure. Requires the openai or zai
 *            embedding provider (1536-dim vectors).
 *
 * SECURITY: every query is scoped by the NextAuth-authenticated
 * userId. The pgvector RPC takes the user id from the trusted server
 * (service key, function revoked from anon/authenticated roles) —
 * the same trust model as every Prisma query in this app. ragdb's
 * original RLS/auth.uid() model is preserved verbatim for the
 * standalone Supabase-auth deployment under supabase/migrations/.
 */

import "@/lib/server-guard";
import { db } from "@/lib/db";
import {
  embedText,
  resolveEmbeddingProvider,
  type EmbeddingProvider,
} from "./embeddings";
import {
  rankChunks,
  type RankOptions,
  type ScoredChunk,
  DEFAULT_TOP_K,
  DEFAULT_MATCH_THRESHOLD,
} from "./similarity";

export type RagDriver = "local" | "supabase";

export interface RetrieveOptions extends RankOptions {
  driver?: RagDriver;
}

export interface RetrievalResult {
  chunks: ScoredChunk[];
  driver: RagDriver;
  providersQueried: EmbeddingProvider[];
  degradedToLocal: boolean;
}

export function resolveRagDriver(): RagDriver {
  const explicit = (process.env.RAG_DRIVER ?? "local").toLowerCase();
  if (explicit === "supabase" && getSupabaseRagConfig()) return "supabase";
  return "local";
}

export function getSupabaseRagConfig(): { url: string; serviceKey: string } | null {
  const url = process.env.RAG_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceKey =
    process.env.RAG_SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/+$/, ""), serviceKey };
}

/**
 * Retrieve the user's most relevant document chunks for a query.
 * userId is mandatory — there is no unscoped retrieval path.
 */
export async function retrieveChunks(
  userId: string,
  query: string,
  options: RetrieveOptions = {}
): Promise<RetrievalResult> {
  if (!userId) throw new Error("retrieveChunks requires a userId");
  const driver = options.driver ?? resolveRagDriver();

  // Short-circuit when the user has no indexed documents — RAG is on
  // by default, so this keeps zero-document chats free of embedding
  // calls entirely.
  const readyDocs = await db.document.count({ where: { userId, status: "ready" } });
  if (readyDocs === 0) {
    return { chunks: [], driver, providersQueried: [], degradedToLocal: false };
  }

  if (driver === "supabase") {
    try {
      const result = await retrieveViaPgvector(userId, query, options);
      return { ...result, driver: "supabase", degradedToLocal: false };
    } catch {
      // Fall through to local — the accelerator must never break chat.
      const local = await retrieveViaLocal(userId, query, options);
      return { ...local, driver: "local", degradedToLocal: true };
    }
  }

  const local = await retrieveViaLocal(userId, query, options);
  return { ...local, driver: "local", degradedToLocal: false };
}

// ----- local driver ----------------------------------------------------

async function retrieveViaLocal(
  userId: string,
  query: string,
  options: RankOptions
): Promise<Omit<RetrievalResult, "driver" | "degradedToLocal">> {
  const rows = await db.documentChunk.findMany({
    where: { userId, document: { status: "ready" } },
    select: {
      id: true,
      documentId: true,
      chunkIndex: true,
      content: true,
      embedding: true,
      document: { select: { title: true, embeddingProvider: true } },
    },
  });

  if (rows.length === 0) {
    return { chunks: [], providersQueried: [] };
  }

  // Documents may have been embedded by different providers over time
  // (e.g. local-dev docs before a key was added). Embed the query once
  // per provider present and rank each group in its own vector space.
  const byProvider = new Map<EmbeddingProvider, typeof rows>();
  for (const row of rows) {
    const provider = row.document.embeddingProvider as EmbeddingProvider;
    const group = byProvider.get(provider) ?? [];
    group.push(row);
    byProvider.set(provider, group);
  }

  const providersQueried: EmbeddingProvider[] = [];
  const scored: ScoredChunk[] = [];
  for (const [provider, group] of byProvider) {
    let queryEmbedding: number[];
    try {
      queryEmbedding = await embedText(query, provider);
    } catch {
      // Provider key was removed after ingest — skip this group rather
      // than failing the whole turn.
      continue;
    }
    providersQueried.push(provider);
    const rankable = group.map((row) => ({
      id: row.id,
      documentId: row.documentId,
      documentTitle: row.document.title,
      chunkIndex: row.chunkIndex,
      content: row.content,
      embedding: safeParseEmbedding(row.embedding),
    }));
    scored.push(...rankChunks(queryEmbedding, rankable, options));
  }

  const topK = options.topK ?? DEFAULT_TOP_K;
  scored.sort((a, b) => b.similarity - a.similarity);
  return { chunks: scored.slice(0, topK), providersQueried };
}

function safeParseEmbedding(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ----- supabase pgvector driver ----------------------------------------

async function retrieveViaPgvector(
  userId: string,
  query: string,
  options: RankOptions
): Promise<Omit<RetrievalResult, "driver" | "degradedToLocal">> {
  const config = getSupabaseRagConfig();
  if (!config) throw new Error("Supabase RAG driver not configured");

  const provider = resolveEmbeddingProvider();
  if (provider === "local") {
    // 256-dim local vectors can't hit the 1536-dim HNSW index.
    throw new Error("pgvector driver requires the openai or zai embedding provider");
  }

  const queryEmbedding = await embedText(query, provider);
  const res = await fetch(`${config.url}/rest/v1/rpc/match_rag_chunks`, {
    method: "POST",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_user_id: userId,
      query_embedding: queryEmbedding,
      match_threshold: options.matchThreshold ?? DEFAULT_MATCH_THRESHOLD,
      match_count: options.topK ?? DEFAULT_TOP_K,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`match_rag_chunks ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    id: string;
    document_id: string;
    document_title: string;
    chunk_index: number;
    content: string;
    similarity: number;
  }[];

  return {
    chunks: (data ?? []).map((r) => ({
      id: r.id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      chunkIndex: r.chunk_index,
      content: r.content,
      similarity: r.similarity,
    })),
    providersQueried: [provider],
  };
}

// ----- pgvector mirror maintenance (called by ingest/delete) ------------

/** Mirror chunk vectors into the pgvector table. Best-effort. */
export async function mirrorChunksToPgvector(
  userId: string,
  documentId: string,
  documentTitle: string,
  chunks: { id: string; chunkIndex: number; content: string; embedding: number[] }[]
): Promise<boolean> {
  const config = getSupabaseRagConfig();
  if (!config || chunks.length === 0) return false;
  const res = await fetch(`${config.url}/rest/v1/rag_chunks`, {
    method: "POST",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(
      chunks.map((c) => ({
        id: c.id,
        user_id: userId,
        document_id: documentId,
        document_title: documentTitle,
        chunk_index: c.chunkIndex,
        content: c.content,
        embedding: c.embedding,
      }))
    ),
  });
  return res.ok;
}

/** Remove a document's vectors from the pgvector mirror. Best-effort. */
export async function removeDocumentFromPgvector(documentId: string): Promise<boolean> {
  const config = getSupabaseRagConfig();
  if (!config) return false;
  const res = await fetch(
    `${config.url}/rest/v1/rag_chunks?document_id=eq.${encodeURIComponent(documentId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
      },
    }
  );
  return res.ok;
}
