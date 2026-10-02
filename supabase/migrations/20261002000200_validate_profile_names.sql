-- Enforce the same person-name character and length rules at the database
-- boundary so direct Supabase requests cannot bypass browser validation.
create or replace function public.is_valid_person_name(value text, max_length integer default 100)
returns boolean
language sql
immutable
as $$
  select value is not null
    and char_length(btrim(normalize(value, NFC))) between 1 and max_length
    and btrim(normalize(value, NFC)) ~ '^[[:alpha:]]([[:alpha:]]|[[:space:]]|[.''-][[:alpha:]])*[.]?$';
$$;

alter table public.profiles
  add constraint profiles_first_name_valid
    check (public.is_valid_person_name(first_name)) not valid,
  add constraint profiles_middle_name_valid
    check (public.is_valid_person_name(middle_name)) not valid,
  add constraint profiles_last_name_valid
    check (public.is_valid_person_name(last_name)) not valid,
  add constraint profiles_suffix_valid
    check (suffix is null or btrim(suffix) = '' or public.is_valid_person_name(suffix)) not valid,
  add constraint profiles_full_name_valid
    check (public.is_valid_person_name(full_name, 403)) not valid;
