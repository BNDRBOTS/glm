-- ============================================================
-- COURSE 1: EXTENSIONS
-- pgvector HNSW with cosine distance operator class
-- ============================================================
create extension if not exists vector with schema extensions;

-- ============================================================
-- COURSE 2: CORE TABLES
-- Every table gets RLS enabled immediately after creation.
-- ============================================================

-- Documents table: owns the source-of-truth metadata.
-- user_id anchors every document to exactly one auth.users row.
create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  file_path   text not null,          -- storage object path
  file_size   bigint not null default 0,
  mime_type   text not null default 'application/octet-stream',
  status      text not null default 'processing'
                check (status in ('processing','ready','error')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.documents enable row level security;

-- Document chunks table: every chunk belongs to a document.
-- Embedding dimensionality: 1536 (OpenAI/DeepSeek compatible).
create table public.document_chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  chunk_index   integer not null,
  content       text not null,
  token_count   integer not null default 0,
  embedding     extensions.vector(1536),
  created_at    timestamptz not null default now()
);

alter table public.document_chunks enable row level security;

-- Chat sessions table
create table public.chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'New Chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.chat_sessions enable row level security;

-- Chat messages table: stores both user turns and assistant turns.
-- thinking_content is stored separately, never in content.
create table public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.chat_sessions(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  role              text not null check (role in ('user','assistant','system')),
  content           text not null,
  thinking_content  text,             -- DeepSeek thinking tokens, never in content
  source_chunks     jsonb,            -- [{chunk_id, document_id, snippet}]
  created_at        timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

-- ============================================================
-- COURSE 3: RLS POLICIES
-- Every table gets USING + WITH CHECK on every applicable DML.
-- The `(select auth.uid())` wrapping prevents per-row re-eval.
-- ============================================================

-- ---- documents ----
create policy "documents_select"
  on public.documents for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "documents_insert"
  on public.documents for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "documents_update"
  on public.documents for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "documents_delete"
  on public.documents for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- ---- document_chunks ----
-- This policy is load-bearing only because similarity search executes under
-- the user's own JWT (the retrieval path uses the anon-key client, so
-- auth.uid() is populated and this USING clause filters every scan to the
-- caller's rows). It is NOT a guarantee against the service-role key, which
-- bypasses RLS entirely; the service role is used solely for trusted
-- server-side writes (message + chunk inserts), never for cross-user reads.
create policy "chunks_select"
  on public.document_chunks for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "chunks_insert"
  on public.document_chunks for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and document_id in (
      select id from public.documents
      where user_id = (select auth.uid())
    )
  );

create policy "chunks_update"
  on public.document_chunks for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "chunks_delete"
  on public.document_chunks for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- ---- chat_sessions ----
create policy "sessions_select"
  on public.chat_sessions for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "sessions_insert"
  on public.chat_sessions for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "sessions_update"
  on public.chat_sessions for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "sessions_delete"
  on public.chat_sessions for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- ---- chat_messages ----
create policy "messages_select"
  on public.chat_messages for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "messages_insert"
  on public.chat_messages for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "messages_update"
  on public.chat_messages for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "messages_delete"
  on public.chat_messages for delete
  to authenticated
  using ( (select auth.uid()) = user_id );

-- ============================================================
-- COURSE 4: INDEXES
-- ============================================================

-- HNSW cosine index on embeddings.
-- vector_cosine_ops maps to <=> operator (cosine distance).
-- m=16, ef_construction=64 are production-grade defaults.
create index document_chunks_embedding_hnsw_idx
  on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- BTree indexes on all FK/filter columns used in RLS policies.
create index documents_user_id_idx
  on public.documents using btree (user_id);

create index chunks_user_id_idx
  on public.document_chunks using btree (user_id);

create index chunks_document_id_idx
  on public.document_chunks using btree (document_id);

create index sessions_user_id_idx
  on public.chat_sessions using btree (user_id);

create index messages_session_id_idx
  on public.chat_messages using btree (session_id);

create index messages_user_id_idx
  on public.chat_messages using btree (user_id);

-- ============================================================
-- COURSE 5: UPDATED_AT TRIGGER
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

create trigger sessions_updated_at
  before update on public.chat_sessions
  for each row execute function public.set_updated_at();
