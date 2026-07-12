-- ============================================================
-- 002_storage.sql
-- Storage bucket + RLS policies for rag-documents.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rag-documents',
  'rag-documents',
  false,
  52428800,
  array[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

-- SELECT: authenticated users may read only their own folder
create policy "rag_docs_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'rag-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- INSERT: authenticated users may upload only into their own folder
create policy "rag_docs_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'rag-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- UPDATE
create policy "rag_docs_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'rag-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'rag-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- DELETE
create policy "rag_docs_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'rag-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Anonymous upload is explicitly blocked by absence of any anon policy.
-- No policy for anon role = no access.
