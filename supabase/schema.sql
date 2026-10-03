-- =========================================================
-- CSDRepoAI Database Schema
-- Run this in Supabase SQL Editor (Project > SQL Editor > New Query)
-- =========================================================

-- 1. PROFILES (extends Supabase auth.users)
-- ---------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null,
  first_name text,
  middle_name text,
  last_name text,
  suffix text,
  role text not null check (role in ('student', 'faculty', 'admin')),
  student_number text,
  faculty_number text,
  program text,
  department text default 'Computer Studies',
  avatar_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Auto-create a profile row whenever a new auth user signs up
create or replace function handle_new_user()
returns trigger as $$
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
      new.raw_user_meta_data->>'full_name',
      trim(
        concat_ws(
          ' ',
          coalesce(new.raw_user_meta_data->>'first_name', ''),
          coalesce(new.raw_user_meta_data->>'middle_name', ''),
          coalesce(new.raw_user_meta_data->>'last_name', ''),
          coalesce(new.raw_user_meta_data->>'suffix', '')
        )
      )
    ),
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'middle_name',
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'suffix',
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    new.raw_user_meta_data->>'student_number',
    new.raw_user_meta_data->>'faculty_number',
    new.raw_user_meta_data->>'program'
  );
  return new;
end;
$$ language plpgsql security definer;

alter table if exists profiles add column if not exists first_name text;
alter table if exists profiles add column if not exists email text;
alter table if exists profiles add column if not exists middle_name text;
alter table if exists profiles add column if not exists last_name text;
alter table if exists profiles add column if not exists suffix text;
alter table if exists profiles add column if not exists faculty_number text;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- 2. RESEARCH SUBMISSIONS (Research Submission + Archive modules)
-- ---------------------------------------------------------
create table if not exists research_papers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  abstract text,
  authors text[] not null default '{}',
  adviser text,
  panel_members text[] default '{}',
  academic_year text,
  is_active boolean not null default true,
  semester text,
  program text,
  keywords text[] default '{}',
  sdg_tags int[] default '{}',            -- SDG Classification Module (e.g. {4,8,9})
  file_url text,                          -- full manuscript (PDF)
  source_code_url text,
  ieee_paper_url text,
  acm_paper_url text,
  apa_paper_url text,
  status text not null default 'pending'  -- pending | under_review | student_editing | approved | rejected | withdrawn
    check (status in ('pending', 'under_review', 'student_editing', 'approved', 'rejected', 'withdrawn')),
  review_notes text,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  submitted_by uuid references profiles(id) not null,
  source text default 'digital' check (source in ('digital', 'ocr_scanned')),
  ocr_raw_text text,                      -- extracted OCR or digital manuscript text
  manuscript_sha256 text,                 -- exact manuscript-file duplicate detection
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table research_papers add column if not exists is_active boolean not null default true;

create or replace function public.prevent_research_paper_delete()
returns trigger language plpgsql security definer set search_path = public as $$
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
drop trigger if exists research_papers_prevent_delete on research_papers;
create trigger research_papers_prevent_delete
  before delete on research_papers
  for each row execute function public.prevent_research_paper_delete();

create or replace function public.guard_research_paper_activation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_active is distinct from old.is_active
    and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'Only administrators can activate or deactivate research papers.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists research_papers_guard_activation on research_papers;
create trigger research_papers_guard_activation
  before update of is_active on research_papers
  for each row execute function public.guard_research_paper_activation();

alter table research_papers drop constraint if exists research_papers_status_check;
alter table research_papers add constraint research_papers_status_check
  check (status in ('pending', 'under_review', 'student_editing', 'approved', 'rejected', 'withdrawn'));

create index if not exists idx_research_status on research_papers(status);
create index if not exists idx_research_submitted_by on research_papers(submitted_by);
create index if not exists idx_research_keywords on research_papers using gin(keywords);
create index if not exists idx_research_sdg on research_papers using gin(sdg_tags);

-- Additional citation-style attachments supported by the submission form.
alter table research_papers add column if not exists acm_paper_url text;
alter table research_papers add column if not exists apa_paper_url text;
alter table research_papers add column if not exists manuscript_sha256 text;

-- Duplicate submissions are checked by title + abstract + keywords in the app.
-- Titles alone may be reused for different studies.
drop index if exists idx_research_unique_normalized_title;
create unique index if not exists idx_research_active_manuscript_sha256
  on research_papers (manuscript_sha256)
  where manuscript_sha256 is not null
    and status not in ('rejected', 'student_editing', 'withdrawn');

-- Full-text search support for the AI-Assisted Search module
alter table research_papers add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(array_to_string(authors, ' '), '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(abstract, '')), 'B') ||
    setweight(array_to_tsvector(coalesce(keywords, '{}')), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce(ocr_raw_text, '')), 'D')
  ) stored;

create index if not exists idx_research_search on research_papers using gin(search_vector);

-- 2b. SEMANTIC SEARCH (Genkit) SUPPORT
-- ---------------------------------------------------------
-- Stores an embedding vector per paper (title + abstract + keywords),
-- generated by the Genkit server (see /genkit-server) using Google's
-- gemini-embedding-001 model (768 dimensions). Populated on submit and
-- on demand via the /reindex-all endpoint.
create extension if not exists vector;

alter table research_papers add column if not exists embedding vector(768);

create index if not exists idx_research_embedding on research_papers
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Cosine-similarity match function called by the Genkit semantic search flow.
-- Runs with definer rights so the Genkit server can use it via a scoped RPC
-- call instead of needing broad table access.
create or replace function match_research_papers(
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
  from research_papers p
  where p.embedding is not null
    and p.is_active = true
    and p.status <> 'rejected'
    and (status_filter is null or p.status = status_filter)
    and (sdg_filter is null or sdg_filter = any(p.sdg_tags))
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

-- 3. SUBMISSION ACTIVITY LOG (for Admin Dashboard / Analytics)
-- ---------------------------------------------------------
create table if not exists submission_logs (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid references research_papers(id) on delete cascade,
  action text not null,        -- submitted | status_changed | ocr_scanned | searched | viewed
  actor_id uuid references profiles(id),
  detail jsonb,
  created_at timestamptz default now()
);

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

create or replace function public.restore_my_withdrawn_research_submission(p_paper_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare previous_status text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'student') then
    raise exception 'Only students can restore their own submissions.' using errcode = '42501';
  end if;

  perform 1 from public.research_papers
  where id = p_paper_id and submitted_by = auth.uid() and status = 'withdrawn'
  for update;
  if not found then
    raise exception 'Withdrawn submission not found or you do not have permission to restore it.' using errcode = '42501';
  end if;

  select detail->>'previous_status' into previous_status
  from public.submission_logs
  where paper_id = p_paper_id and action = 'student_withdrew'
  order by created_at desc limit 1;
  if previous_status is null or previous_status not in ('pending', 'under_review', 'student_editing', 'rejected') then
    previous_status := 'pending';
  end if;

  update public.research_papers set status = previous_status, updated_at = now() where id = p_paper_id;
  insert into public.submission_logs (paper_id, action, actor_id, detail)
  values (p_paper_id, 'student_restored', auth.uid(), jsonb_build_object('status', previous_status));
  return previous_status;
end;
$$;

create or replace function public.permanently_delete_my_withdrawn_research_submission(p_paper_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'student') then
    raise exception 'Only students can permanently delete their own submissions.' using errcode = '42501';
  end if;

  perform 1 from public.research_papers
  where id = p_paper_id and submitted_by = auth.uid() and status = 'withdrawn'
  for update;
  if not found then
    raise exception 'Only your withdrawn submissions can be permanently deleted.' using errcode = '42501';
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

-- Safe repository activity shown to every signed-in user's notification bell.
create table if not exists public_notifications (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references research_papers(id) on delete cascade,
  notification_type text not null default 'paper_published'
    check (notification_type = 'paper_published'),
  actor_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (paper_id, notification_type)
);

create or replace function public.notify_paper_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  should_notify boolean;
begin
  if tg_op = 'INSERT' then
    should_notify := true;
  else
    should_notify := old.status is distinct from 'approved'
      or old.is_active is distinct from true;
  end if;

  if should_notify and new.status = 'approved' and new.is_active then
    insert into public.public_notifications (paper_id, notification_type, actor_id)
    values (new.id, 'paper_published', coalesce(new.reviewed_by, new.submitted_by))
    on conflict (paper_id, notification_type) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists research_paper_publish_notification on public.research_papers;
create trigger research_paper_publish_notification
  after insert or update of status, is_active on public.research_papers
  for each row execute function public.notify_paper_published();

create table if not exists academic_years (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  is_active boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create or replace function public.validate_academic_year_label()
returns trigger language plpgsql security definer set search_path = public as $$
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
    raise exception 'Please enter a valid academic year. The ending year must be exactly one year after the starting year.' using errcode = '22023';
  end if;
  start_year := split_part(canonical_label, '-', 1)::integer;
  end_year := split_part(canonical_label, '-', 2)::integer;
  if end_year <> start_year + 1 then
    raise exception 'Please enter a valid academic year. The ending year must be exactly one year after the starting year.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then excluded_id := old.id; end if;
  perform pg_advisory_xact_lock(hashtext(canonical_label));
  if exists (
    select 1 from public.academic_years existing
    where regexp_replace(btrim(existing.label), '[[:space:]]*-[[:space:]]*', '-', 'g') = canonical_label
      and (excluded_id is null or existing.id <> excluded_id)
  ) then
    raise exception 'Academic year % already exists.', canonical_label using errcode = '23505';
  end if;
  new.label := canonical_label;
  return new;
end;
$$;

drop trigger if exists academic_years_validate_label on academic_years;
create trigger academic_years_validate_label
  before insert or update of label on academic_years
  for each row execute function public.validate_academic_year_label();

create index if not exists idx_academic_years_active on academic_years(is_active, sort_order, label);

-- Academic years referenced by research papers must remain in the lookup list.
create or replace function prevent_deleting_used_academic_year()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from research_papers
    where regexp_replace(btrim(academic_year), '[[:space:]]*-[[:space:]]*', '-', 'g')
      = regexp_replace(btrim(old.label), '[[:space:]]*-[[:space:]]*', '-', 'g')
  ) then
    raise exception 'Academic year "%" cannot be deleted because it is used by one or more research papers.', old.label
      using errcode = '23503';
  end if;

  return old;
end;
$$;

drop trigger if exists academic_years_prevent_used_delete on academic_years;
create trigger academic_years_prevent_used_delete
  before delete on academic_years
  for each row execute function prevent_deleting_used_academic_year();

create table if not exists system_evaluations (
  id uuid primary key default gen_random_uuid(),
  respondent_id uuid references profiles(id) on delete cascade not null unique,
  sus_answers int[] not null,
  iso_answers jsonb not null default '{}'::jsonb,
  comments text,
  created_at timestamptz default now()
);

-- 4. SDG REFERENCE TABLE (Sustainable Development Goals lookup)
-- ---------------------------------------------------------
create table if not exists sdg_list (
  id int primary key,
  title text not null
);

insert into sdg_list (id, title) values
  (1,'No Poverty'),(2,'Zero Hunger'),(3,'Good Health and Well-being'),
  (4,'Quality Education'),(5,'Gender Equality'),(6,'Clean Water and Sanitation'),
  (7,'Affordable and Clean Energy'),(8,'Decent Work and Economic Growth'),
  (9,'Industry, Innovation and Infrastructure'),(10,'Reduced Inequalities'),
  (11,'Sustainable Cities and Communities'),(12,'Responsible Consumption and Production'),
  (13,'Climate Action'),(14,'Life Below Water'),(15,'Life on Land'),
  (16,'Peace, Justice and Strong Institutions'),(17,'Partnerships for the Goals')
on conflict (id) do nothing;

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
alter table profiles enable row level security;
alter table research_papers enable row level security;
alter table submission_logs enable row level security;
alter table public_notifications enable row level security;
alter table academic_years enable row level security;
alter table system_evaluations enable row level security;
alter table sdg_list enable row level security;

-- Profiles: everyone signed in can read profiles (needed for names on papers),
-- but a user can only edit their own profile. Admins can edit any profile.
drop policy if exists "profiles_select_all" on profiles;
create policy "profiles_select_all" on profiles for select
  using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles for update
  using (auth.uid() = id);

drop policy if exists "profiles_admin_update_any" on profiles;
create policy "profiles_admin_update_any" on profiles for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "profiles_admin_delete_any" on profiles;
create policy "profiles_admin_delete_any" on profiles for delete
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Research papers:
-- Students can see approved papers + their own papers (any status).
-- Faculty/Admin can see everything.
drop policy if exists "papers_select" on research_papers;
create policy "papers_select" on research_papers for select
  using (
    (status = 'approved' and is_active = true)
    or submitted_by = auth.uid()
    or exists (
      select 1 from profiles p where p.id = auth.uid() and p.role in ('faculty', 'admin')
    )
  );

drop policy if exists "papers_insert_own" on research_papers;
create policy "papers_insert_own" on research_papers for insert
  with check (submitted_by = auth.uid());

drop policy if exists "papers_update_own_or_admin" on research_papers;
create policy "papers_update_own_or_admin" on research_papers for update
  using (
    submitted_by = auth.uid()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('faculty', 'admin'))
  );

drop policy if exists "papers_admin_delete" on research_papers;
-- Research paper rows and their history/files are preserved; deletion is blocked by trigger below.

-- Submission logs: readable by faculty/admin, insertable by any authenticated user
drop policy if exists "logs_select_staff" on submission_logs;
create policy "logs_select_staff" on submission_logs for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('faculty', 'admin')));

-- Students can see activity for their own submissions so the portal can show
-- review and status notifications without exposing other students' activity.
drop policy if exists "logs_select_own_submission_activity" on submission_logs;
create policy "logs_select_own_submission_activity" on submission_logs for select
  using (exists (
    select 1 from research_papers paper
    where paper.id = submission_logs.paper_id
      and paper.submitted_by = auth.uid()
  ));

drop policy if exists "logs_insert_any" on submission_logs;
create policy "logs_insert_any" on submission_logs for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "public_notifications_select_authenticated" on public_notifications;
create policy "public_notifications_select_authenticated" on public_notifications for select
  using (auth.role() = 'authenticated');

-- Academic years: authenticated users can read the list; admins can manage it
-- for the repository-wide term catalog used by submissions and OCR review.
drop policy if exists "academic_years_select_authenticated" on academic_years;
create policy "academic_years_select_authenticated" on academic_years for select
  using (auth.role() = 'authenticated');

drop policy if exists "academic_years_admin_manage" on academic_years;
create policy "academic_years_admin_manage" on academic_years for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "evaluations_insert_own" on system_evaluations;
create policy "evaluations_insert_own" on system_evaluations for insert
  with check (respondent_id = auth.uid());

drop policy if exists "evaluations_update_own" on system_evaluations;
create policy "evaluations_update_own" on system_evaluations for update
  using (respondent_id = auth.uid());

drop policy if exists "evaluations_select_admin" on system_evaluations;
create policy "evaluations_select_admin" on system_evaluations for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') or respondent_id = auth.uid());

-- SDG reference list: static lookup data (17 fixed rows), safe for anyone
-- to read. No insert/update/delete policy — only edited manually in the
-- SQL editor, never from the app.
drop policy if exists "sdg_list_select_all" on sdg_list;
create policy "sdg_list_select_all" on sdg_list for select
  using (true);

-- =========================================================
-- VIEW / DOWNLOAD TRACKING (for the "Most Viewed/Downloaded" analytics)
-- =========================================================
alter table research_papers add column if not exists view_count int not null default 0;
alter table research_papers add column if not exists download_count int not null default 0;

-- security definer so any authenticated reader can register a view/download
-- even on a paper they don't own (RLS on research_papers would otherwise
-- block that update)
create or replace function increment_view_count(p_paper_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update research_papers set view_count = view_count + 1 where id = p_paper_id;
$$;

create or replace function increment_download_count(p_paper_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update research_papers set download_count = download_count + 1 where id = p_paper_id;
$$;

grant execute on function increment_view_count(uuid) to authenticated;
grant execute on function increment_download_count(uuid) to authenticated;

-- =========================================================
-- STORAGE BUCKETS (run once; Supabase Dashboard > Storage also works)
-- =========================================================
insert into storage.buckets (id, name, public)
values ('research-files', 'research-files', true)
on conflict (id) do nothing;

drop policy if exists "research_files_read" on storage.objects;
create policy "research_files_read" on storage.objects for select
  using (bucket_id = 'research-files');

drop policy if exists "research_files_upload" on storage.objects;
create policy "research_files_upload" on storage.objects for insert
  with check (bucket_id = 'research-files' and auth.role() = 'authenticated');

drop policy if exists "research_files_admin_delete" on storage.objects;
create policy "research_files_admin_delete" on storage.objects for delete
  using (bucket_id = 'research-files' and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ));

drop policy if exists "research_files_delete_own_withdrawn_submission" on storage.objects;
create policy "research_files_delete_own_withdrawn_submission" on storage.objects for delete
  using (
    bucket_id = 'research-files'
    and exists (
      select 1 from public.research_papers p
      where p.submitted_by = auth.uid() and p.status = 'withdrawn'
        and (
          position(name in coalesce(p.file_url, '')) > 0
          or position(name in coalesce(p.source_code_url, '')) > 0
          or position(name in coalesce(p.ieee_paper_url, '')) > 0
          or position(name in coalesce(p.acm_paper_url, '')) > 0
          or position(name in coalesce(p.apa_paper_url, '')) > 0
        )
    )
  );
