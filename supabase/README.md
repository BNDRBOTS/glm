# Supabase artifacts — two RAG deployment flavors

The merged platform ships **both** RAG storage models. Pick one (or neither — the
default needs no Supabase at all).

## Default: local driver (no Supabase)

Do nothing. Documents, chunks, and embedding vectors live in the primary Prisma
database (SQLite in dev, PostgreSQL on Railway). Retrieval is exact cosine
similarity in-process, scoped per user. Zero extra infrastructure, works with
zero API keys (deterministic local embeddings) and upgrades transparently to
OpenAI / Z.ai embeddings when a key is present.

## Option A: pgvector accelerator for the merged platform

For large corpora, mirror vectors into a Supabase pgvector table with an HNSW
index (the same index geometry ragdb shipped: `m=16, ef_construction=64`,
cosine ops, `ef_search=100`).

1. Run `rag/101_rag_pgvector.sql` in the Supabase SQL editor.
2. Set in the environment:
   ```
   RAG_DRIVER=supabase
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...        # server-only, never client
   ```
3. Use the `openai` or `zai` embedding provider (1536-dim vectors — the local
   256-dim fallback cannot hit the 1536-dim index; the platform refuses the
   combination and falls back to the local driver).

Isolation model: the platform authenticates with NextAuth, so `auth.uid()` is
unavailable. The `match_rag_chunks` RPC takes an explicit `p_user_id` that the
trusted server always sets to the authenticated user; `EXECUTE` is revoked from
`anon`/`authenticated`, and the table has RLS enabled with no policies — only
the service role (a server-side secret) can reach it.

Resilience: the mirror is an accelerator, never the source of truth. If the
RPC fails or the config is removed, retrieval degrades to the local driver
automatically (audited, non-fatal) — chat never breaks.

## Option B: original ragdb standalone schema (preserved verbatim)

`migrations/001_initial.sql`, `002_storage.sql`, `003_match_chunks.sql` are the
untouched migrations from the ragdb repository — Supabase-Auth-native, RLS on
every table, `match_chunks` as `SECURITY INVOKER` under the caller's JWT, and a
private `rag-documents` storage bucket. Use these if you deploy a
Supabase-Auth-based flavor or want the original multi-tenant RLS model as a
reference. They are safe to re-run (`create or replace` / `on conflict do
nothing` throughout).
