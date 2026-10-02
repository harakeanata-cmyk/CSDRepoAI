-- Keep academic years that are already assigned to research papers.
create or replace function public.prevent_deleting_used_academic_year()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.research_papers
    where academic_year = old.label
  ) then
    raise exception 'Academic year "%" cannot be deleted because it is used by one or more research papers.', old.label
      using errcode = '23503';
  end if;

  return old;
end;
$$;

drop trigger if exists academic_years_prevent_used_delete on public.academic_years;
create trigger academic_years_prevent_used_delete
  before delete on public.academic_years
  for each row execute function public.prevent_deleting_used_academic_year();

notify pgrst, 'reload schema';
