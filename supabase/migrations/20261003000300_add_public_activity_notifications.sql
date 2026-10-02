-- Provide every signed-in user with the same safe, public repository feed.
-- Pending and rejected submissions are deliberately excluded.
create table if not exists public.public_notifications (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.research_papers(id) on delete cascade,
  notification_type text not null default 'paper_published'
    check (notification_type = 'paper_published'),
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (paper_id, notification_type)
);

alter table public.public_notifications enable row level security;

drop policy if exists "public_notifications_select_authenticated" on public.public_notifications;
create policy "public_notifications_select_authenticated" on public.public_notifications
  for select
  using (auth.role() = 'authenticated');

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

-- Seed the feed with recent papers that were already published.
with recent_papers as (
  select
    p.id,
    coalesce(p.reviewed_by, p.submitted_by) as actor_id,
    coalesce(p.reviewed_at, p.created_at, now()) as published_at
  from public.research_papers p
  where p.status = 'approved'
    and p.is_active = true
  order by coalesce(p.reviewed_at, p.created_at, now()) desc
  limit 100
)
insert into public.public_notifications (paper_id, notification_type, actor_id, created_at)
select id, 'paper_published', actor_id, published_at
from recent_papers
on conflict (paper_id, notification_type) do nothing;
