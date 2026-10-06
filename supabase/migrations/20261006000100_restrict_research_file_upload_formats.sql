-- Match Storage uploads to the formats supported by Submit Research:
-- manuscripts accept PDF/DOCX, source archives accept ZIP, and style papers
-- accept PDF. This also blocks unsupported extensions sent outside the app.
drop policy if exists "research_files_upload" on storage.objects;
create policy "research_files_upload" on storage.objects for insert
  with check (
    bucket_id = 'research-files'
    and auth.role() = 'authenticated'
    and lower(storage.extension(name)) in ('pdf', 'docx', 'zip')
  );
