-- ============================================================
-- 101_rag_pgvector.sql — merged-platform pgvector accelerator
-- ------------------------------------------------------------
-- OPTIONAL. The platform's default RAG driver ("local") needs no
-- Supabase at all — chunks + vectors live in the primary Prisma
-- database and retrieval is exact cosine in-process.
--
-- Run this migration and set RAG_DRIVER=supabase (+ SUPABASE_URL,
-- SUPABASE_SERVICE_ROLE_KEY) to mirror vectors into an HNSW-indexed
-- pgvector table for ANN-speed retrieval — the same index geometry
-- ragdb shipped (m=16, ef_construction=64, cosine ops, ef_search=100).
--
-- SECURITY MODEL (differs from supabase/migrations/003 by design):
--   The merged platform authenticates with NextAuth, not Supabase
--   Auth, so there is no per-user JWT and auth.uid() is unavailable.
--   Isolation is enforced by the trusted application server: the
--   RPC takes an explicit p_user_id which the server always sets to
--   the NextAuth-authenticated user — the same trust model as every
--   Prisma query in the app. Defense in depth:
--     * user ids here are Prisma cuids (text), never client-supplied
--     * EXECUTE is revoked from anon + authenticated — only the
--       service role (server-side secret) can call the RPC
--     * RLS is enabled with no policies: the anon/authenticated
--       roles cannot touch the table at all
--   ragdb's original RLS/auth.uid() model remains intact in
--   supabase/migrations/ for the standalone Supabase-auth flavor.
-- ============================================================

create extension if not exists vector with schema extensions;

create table if not exists public.rag_chunks (
  id             text primary key,
  user_id        text not null,
  document_id    text not null,
  document_title text not null default '',
  chunk_index    integer not null,
  content        text not null,
  embedding      extensions.vector(1536),
  created_at     timestamptz not null default now()
);

-- RLS on, zero policies: anon/authenticated get nothing. The service
-- role bypasses RLS — it is the only intended caller.
alter table public.rag_chunks enable row level security;

create index if not exists rag_chunks_embedding_hnsw_idx
  on public.rag_chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists rag_chunks_user_id_idx
  on public.rag_chunks using btree (user_id);

create index if not exists rag_chunks_document_id_idx
  on public.rag_chunks using btree (document_id);

create or replace function public.match_rag_chunks(
  p_user_id text,
  query_embedding extensions.vector(1536),
  match_threshold double precision,
  match_count integer
)
returns table (
  id text,
  document_id text,
  document_title text,
  chunk_index integer,
  content text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
set hnsw.ef_search = '100'
as $$
  select
    rc.id,
    rc.document_id,
    rc.document_title,
    rc.chunk_index,
    rc.content,
    1 - (rc.embedding <=> query_embedding) as similarity
  from public.rag_chunks rc
  where rc.user_id = p_user_id
    and rc.embedding is not null
    and (rc.embedding <=> query_embedding) < (1 - match_threshold)
  order by rc.embedding <=> query_embedding
  limit match_count;
$$;

-- Server-only: nothing below the service role may execute the RPC.
revoke execute on function public.match_rag_chunks(text, extensions.vector, double precision, integer)
  from anon, authenticated, public;
