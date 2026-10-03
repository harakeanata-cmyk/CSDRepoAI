-- Let students restore or permanently delete only their own withdrawn submissions.
create or replace function public.prevent_research_paper_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.allow_student_submission_delete', true) = 'on'
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'student'
    ) then
    return old;
  end if;

  raise exception 'Research papers cannot be permanently deleted directly. Use the student recycle bin for withdrawn submissions.'
    using errcode = '55000';
end;
$$;

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

create or replace function public.permanently_delete_my_withdrawn_research_submission(p_paper_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Only students can permanently delete their own submissions.'
      using errcode = '42501';
  end if;

  perform 1 from public.research_papers
  where id = p_paper_id and submitted_by = auth.uid() and status = 'withdrawn'
  for update;

  if not found then
    raise exception 'Only your withdrawn submissions can be permanently deleted.'
      using errcode = '42501';
  end if;

  perform set_config('app.allow_student_submission_delete', 'on', true);
  delete from public.research_papers
  where id = p_paper_id and submitted_by = auth.uid() and status = 'withdrawn';
  perform set_config('app.allow_student_submission_delete', 'off', true);
end;
$$;

revoke all on function public.restore_my_withdrawn_research_submission(uuid) from public;
revoke all on function public.permanently_delete_my_withdrawn_research_submission(uuid) from public;
grant execute on function public.restore_my_withdrawn_research_submission(uuid) to authenticated;
grant execute on function public.permanently_delete_my_withdrawn_research_submission(uuid) to authenticated;

-- Permit removal only for file objects referenced by the caller's withdrawn papers.
drop policy if exists "research_files_delete_own_withdrawn_submission" on storage.objects;
create policy "research_files_delete_own_withdrawn_submission" on storage.objects for delete
  using (
    bucket_id = 'research-files'
    and exists (
      select 1 from public.research_papers p
      where p.submitted_by = auth.uid()
        and p.status = 'withdrawn'
        and (
          position(name in coalesce(p.file_url, '')) > 0
          or position(name in coalesce(p.source_code_url, '')) > 0
          or position(name in coalesce(p.ieee_paper_url, '')) > 0
          or position(name in coalesce(p.acm_paper_url, '')) > 0
          or position(name in coalesce(p.apa_paper_url, '')) > 0
        )
    )
  );
