-- Let students clear an unapproved submission without deleting its record or history.
alter table public.research_papers
  drop constraint if exists research_papers_status_check;

alter table public.research_papers
  add constraint research_papers_status_check
  check (status in ('pending', 'under_review', 'student_editing', 'approved', 'rejected', 'withdrawn'));

drop index if exists public.idx_research_active_manuscript_sha256;
create unique index idx_research_active_manuscript_sha256
  on public.research_papers (manuscript_sha256)
  where manuscript_sha256 is not null
    and status not in ('rejected', 'student_editing', 'withdrawn');

create or replace function public.withdraw_my_research_submission(p_paper_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Only students can clear their own submissions.'
      using errcode = '42501';
  end if;

  select status into current_status
  from public.research_papers
  where id = p_paper_id and submitted_by = auth.uid()
  for update;

  if not found then
    raise exception 'Submission not found or you do not have permission to clear it.'
      using errcode = '42501';
  end if;

  if current_status not in ('pending', 'under_review', 'student_editing', 'rejected') then
    raise exception 'Only submissions that have not been approved can be cleared.'
      using errcode = '55000';
  end if;

  update public.research_papers
  set status = 'withdrawn', updated_at = now()
  where id = p_paper_id;

  insert into public.submission_logs (paper_id, action, actor_id, detail)
  values (
    p_paper_id,
    'student_withdrew',
    auth.uid(),
    jsonb_build_object('previous_status', current_status)
  );
end;
$$;

revoke all on function public.withdraw_my_research_submission(uuid) from public;
grant execute on function public.withdraw_my_research_submission(uuid) to authenticated;
