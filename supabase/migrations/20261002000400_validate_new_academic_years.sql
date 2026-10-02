-- Validate and canonicalize new/edited academic-year labels only.
-- Existing rows and research-paper values are intentionally left unchanged.
create or replace function public.validate_academic_year_label()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  canonical_label text;
  start_year integer;
  end_year integer;
  excluded_id uuid;
begin
  if tg_op = 'UPDATE' and new.label is not distinct from old.label then
    return new;
  end if;

  canonical_label := regexp_replace(btrim(new.label), '[[:space:]]*-[[:space:]]*', '-', 'g');
  if canonical_label !~ '^[0-9]{4}-[0-9]{4}$' then
    raise exception 'Please enter a valid academic year. The ending year must be exactly one year after the starting year.'
      using errcode = '22023';
  end if;

  start_year := split_part(canonical_label, '-', 1)::integer;
  end_year := split_part(canonical_label, '-', 2)::integer;
  if end_year <> start_year + 1 then
    raise exception 'Please enter a valid academic year. The ending year must be exactly one year after the starting year.'
      using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    excluded_id := old.id;
  end if;
  perform pg_advisory_xact_lock(hashtext(canonical_label));
  if exists (
    select 1
    from public.academic_years existing
    where regexp_replace(btrim(existing.label), '[[:space:]]*-[[:space:]]*', '-', 'g') = canonical_label
      and (excluded_id is null or existing.id <> excluded_id)
  ) then
    raise exception 'Academic year % already exists.', canonical_label
      using errcode = '23505';
  end if;

  new.label := canonical_label;
  return new;
end;
$$;

drop trigger if exists academic_years_validate_label on public.academic_years;
create trigger academic_years_validate_label
  before insert or update of label on public.academic_years
  for each row execute function public.validate_academic_year_label();

-- Protect a year even if a legacy paper/year pair differs only by hyphen spacing.
create or replace function public.prevent_deleting_used_academic_year()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.research_papers paper
    where regexp_replace(btrim(paper.academic_year), '[[:space:]]*-[[:space:]]*', '-', 'g')
      = regexp_replace(btrim(old.label), '[[:space:]]*-[[:space:]]*', '-', 'g')
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
