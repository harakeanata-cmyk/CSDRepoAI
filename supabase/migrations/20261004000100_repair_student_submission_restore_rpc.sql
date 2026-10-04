-- Recreate the restore RPC for projects where the recycle-bin migration was
-- not applied, then refresh PostgREST's function schema cache.
create or replace function public.restore_my_withdrawn_research_submission(p_paper_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_status text;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Only students can restore their own submissions.'
      using errcode = '42501';
  end if;

  perform 1 from public.research_papers
  where id = p_paper_id and submitted_by = auth.uid() and status = 'withdrawn'
  for update;

  if not found then
    raise exception 'Withdrawn submission not found or you do not have permission to restore it.'
      using errcode = '42501';
  end if;

  select detail->>'previous_status' into previous_status
  from public.submission_logs
  where paper_id = p_paper_id and action = 'student_withdrew'
  order by created_at desc
  limit 1;

  if previous_status is null or previous_status not in ('pending', 'under_review', 'student_editing', 'rejected') then
    previous_status := 'pending';
  end if;

  update public.research_papers
  set status = previous_status, updated_at = now()
  where id = p_paper_id;

  insert into public.submission_logs (paper_id, action, actor_id, detail)
  values (p_paper_id, 'student_restored', auth.uid(), jsonb_build_object('status', previous_status));

  return previous_status;
end;
$$;

revoke all on function public.restore_my_withdrawn_research_submission(uuid) from public;
grant execute on function public.restore_my_withdrawn_research_submission(uuid) to authenticated;

notify pgrst, 'reload schema';
