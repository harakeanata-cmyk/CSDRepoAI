-- Preserve research records and their related history and files.
alter table public.research_papers
  add column if not exists is_active boolean not null default true;

drop policy if exists "papers_admin_delete" on public.research_papers;
drop policy if exists "papers_select" on public.research_papers;
create policy "papers_select" on public.research_papers for select
  using (
    (status = 'approved' and is_active = true)
    or submitted_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('faculty', 'admin')
    )
  );

create or replace function public.prevent_research_paper_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Research papers cannot be permanently deleted. Deactivate the record instead.'
    using errcode = '55000';
end;
$$;

drop trigger if exists research_papers_prevent_delete on public.research_papers;
create trigger research_papers_prevent_delete
  before delete on public.research_papers
  for each row execute function public.prevent_research_paper_delete();

create or replace function public.guard_research_paper_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active is distinct from old.is_active
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'Only administrators can activate or deactivate research papers.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists research_papers_guard_activation on public.research_papers;
create trigger research_papers_guard_activation
  before update of is_active on public.research_papers
  for each row execute function public.guard_research_paper_activation();

create or replace function public.match_research_papers(
  query_embedding vector(768),
  match_count int default 30,
  status_filter text default 'approved',
  sdg_filter int default null
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
    and (status_filter is null or p.status = status_filter)
    and (sdg_filter is null or sdg_filter = any(p.sdg_tags))
  order by p.embedding <=> query_embedding
  limit match_count;
$$;
