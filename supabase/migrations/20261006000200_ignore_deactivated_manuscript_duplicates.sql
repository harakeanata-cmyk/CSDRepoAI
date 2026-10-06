-- A deactivated archive entry should not block a new submission of its file.
-- Keep duplicate protection for active papers that are still in circulation.
drop index if exists public.idx_research_active_manuscript_sha256;
create unique index idx_research_active_manuscript_sha256
  on public.research_papers (manuscript_sha256)
  where manuscript_sha256 is not null
    and is_active = true
    and status not in ('rejected', 'student_editing', 'withdrawn');
