-- ============================================================
-- 003_match_chunks.sql
-- RPC for cosine-similarity search over chunks.
--
-- SECURITY MODEL (load-bearing, not narrative):
--   This function is SECURITY INVOKER. It is called with the
--   end user's JWT, so it executes as the `authenticated` role
--   and RLS on document_chunks applies to every row it touches.
--   The explicit `user_id = auth.uid()` predicate below is a
--   second, independent guard so isolation survives even if RLS
--   were ever disabled. There is no caller-supplied user id to
--   spoof. The service-role key must never call this function.
--
-- PERFORMANCE:
--   Ordering by the raw `<=>` distance is what lets the planner
--   use the HNSW index. ef_search is raised so that filtering by
--   user_id does not starve recall on multi-tenant data.
-- ============================================================

create or replace function public.match_chunks(
  query_embedding extensions.vector(1536),
  match_threshold double precision,
  match_count integer
)
returns table (
  id uuid,
  document_id uuid,
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
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where dc.user_id = (select auth.uid())
    and dc.embedding is not null
    and (dc.embedding <=> query_embedding) < (1 - match_threshold)
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;
