-- Keep the profile directory aligned with Supabase Auth. Older deployments
-- may have auth users created before the profile trigger was installed.
alter table public.profiles add column if not exists email text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  metadata_role text := new.raw_user_meta_data->>'role';
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    first_name,
    middle_name,
    last_name,
    suffix,
    role,
    student_number,
    faculty_number,
    program
  )
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(trim(concat_ws(' ',
        new.raw_user_meta_data->>'first_name',
        new.raw_user_meta_data->>'middle_name',
        new.raw_user_meta_data->>'last_name',
        new.raw_user_meta_data->>'suffix'
      )), ''),
      new.email,
      'Unnamed user'
    ),
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'middle_name',
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'suffix',
    case when metadata_role in ('student', 'faculty', 'admin') then metadata_role else 'student' end,
    new.raw_user_meta_data->>'student_number',
    new.raw_user_meta_data->>'faculty_number',
    new.raw_user_meta_data->>'program'
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Repair accounts created while the profile trigger was missing or failing.
insert into public.profiles (
  id,
  email,
  full_name,
  first_name,
  middle_name,
  last_name,
  suffix,
  role,
  student_number,
  faculty_number,
  program
)
select
  u.id,
  u.email,
  coalesce(
    nullif(u.raw_user_meta_data->>'full_name', ''),
    nullif(trim(concat_ws(' ',
      u.raw_user_meta_data->>'first_name',
      u.raw_user_meta_data->>'middle_name',
      u.raw_user_meta_data->>'last_name',
      u.raw_user_meta_data->>'suffix'
    )), ''),
    u.email,
    'Unnamed user'
  ),
  u.raw_user_meta_data->>'first_name',
  u.raw_user_meta_data->>'middle_name',
  u.raw_user_meta_data->>'last_name',
  u.raw_user_meta_data->>'suffix',
  case
    when u.raw_user_meta_data->>'role' in ('student', 'faculty', 'admin')
      then u.raw_user_meta_data->>'role'
    else 'student'
  end,
  u.raw_user_meta_data->>'student_number',
  u.raw_user_meta_data->>'faculty_number',
  u.raw_user_meta_data->>'program'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- Also fill the email column for profiles that already existed.
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and p.email is distinct from u.email;
