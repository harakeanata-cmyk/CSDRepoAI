-- Allow administrators to permanently remove mistaken archive submissions.
-- The application calls the guarded RPC only after explicit confirmation.
drop policy if exists "papers_admin_delete" on public.research_papers;
create policy "papers_admin_delete" on public.research_papers for delete
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ));

create or replace function public.prevent_research_paper_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.allow_student_submission_delete', true) = 'on'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'student') then
    return old;
  end if;

  if current_setting('app.allow_admin_research_delete', true) = 'on'
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    return old;
  end if;

  raise exception 'Research records can only be deleted through an authorized deletion workflow.'
    using errcode = '55000';
end;
$$;

create or replace function public.admin_delete_research_paper(p_paper_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Only administrators can permanently delete research records.'
      using errcode = '42501';
  end if;

  perform 1 from public.research_papers where id = p_paper_id for update;
  if not found then
    raise exception 'Research record not found. Refresh the archive and try again.'
      using errcode = 'P0002';
  end if;

  perform set_config('app.allow_admin_research_delete', 'on', true);
  delete from public.research_papers where id = p_paper_id;
end;
$$;

revoke all on function public.admin_delete_research_paper(uuid) from public;
grant execute on function public.admin_delete_research_paper(uuid) to authenticated;
