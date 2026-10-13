-- Let the trusted Genkit service compare a manuscript to the caller's own
-- active submissions while keeping other students' unapproved work private.
-- The original four-argument function remains available for existing searches.
create or replace function public.match_research_papers(
  query_embedding vector(768),
  match_count int,
  status_filter text,
  sdg_filter int,
  submitter_filter uuid
)
returns table (
  id uuid,
  title text,
  abstract text,
  authors text[],
  keywords text[],
  sdg_tags int[],
  file_url text,
  status text,
  created_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    p.id, p.title, p.abstract, p.authors, p.keywords, p.sdg_tags,
    p.file_url, p.status, p.created_at,
    1 - (p.embedding <=> query_embedding) as similarity
  from public.research_papers p
  where p.is_active = true
    and p.embedding is not null
    and p.status <> 'rejected'
    and p.status <> 'withdrawn'
    and (
      (submitter_filter is null and (status_filter is null or p.status = status_filter))
      or p.status = 'approved'
      or (submitter_filter is not null and p.submitted_by = submitter_filter)
    )
    and (sdg_filter is null or sdg_filter = any(p.sdg_tags))
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

-- Only the server-side service-role client should use this owner-scoped overload.
revoke all on function public.match_research_papers(vector, int, text, int, uuid) from public, anon, authenticated;
grant execute on function public.match_research_papers(vector, int, text, int, uuid) to service_role;
