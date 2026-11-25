-- ROUTER.ESPORTS: Reels engagement and moderator review foundation
-- Moderation authority is read from trusted auth.app_metadata, never user_metadata.
-- This migration is committed for review; it is not applied to the live project here.

create table if not exists public.social_clip_likes (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.social_clips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint social_clip_likes_one_per_user unique (clip_id, user_id)
);

create table if not exists public.social_clip_comments (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.social_clips(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  status text not null default 'visible'
    check (status in ('visible', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_clip_comments_body_length
    check (char_length(btrim(body)) between 1 and 1000)
);

create table if not exists public.social_clip_reports (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.social_clips(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in (
    'harassment', 'hate_or_abuse', 'cheating_or_exploits',
    'copyright', 'privacy_or_personal_data', 'spam', 'other'
  )),
  details text,
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  resolution_note text,
  constraint social_clip_reports_details_length
    check (details is null or char_length(details) <= 1000),
  constraint social_clip_reports_one_per_user
    unique (clip_id, reporter_id)
);

create table if not exists public.social_clip_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid references public.social_clips(id) on delete set null,
  comment_id uuid references public.social_clip_comments(id) on delete set null,
  report_id uuid references public.social_clip_reports(id) on delete set null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in (
    'approve_clip', 'reject_clip', 'hide_clip', 'restore_clip',
    'remove_clip', 'hide_comment', 'restore_comment',
    'resolve_report', 'dismiss_report'
  )),
  reason text not null check (char_length(btrim(reason)) between 3 and 1000),
  created_at timestamptz not null default now(),
  constraint social_clip_moderation_action_target
    check (num_nonnulls(clip_id, comment_id, report_id) = 1)
);

alter table public.social_clips
  drop constraint if exists social_clips_status_check;
alter table public.social_clips
  add constraint social_clips_status_check
  check (status in ('pending', 'approved', 'rejected', 'hidden', 'removed'));

alter table public.social_clips
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists moderation_note text;

create index if not exists social_clip_likes_clip_created_idx
  on public.social_clip_likes (clip_id, created_at desc);
create index if not exists social_clip_comments_clip_created_idx
  on public.social_clip_comments (clip_id, created_at asc);
create index if not exists social_clip_reports_status_created_idx
  on public.social_clip_reports (status, created_at asc);
create index if not exists social_clip_moderation_actions_clip_created_idx
  on public.social_clip_moderation_actions (clip_id, created_at desc);

alter table public.social_clip_likes enable row level security;
alter table public.social_clip_comments enable row level security;
alter table public.social_clip_reports enable row level security;
alter table public.social_clip_moderation_actions enable row level security;

-- Public engagement is visible only for approved clips from public profiles.
create policy "Players read likes on visible clips"
  on public.social_clip_likes for select to authenticated
  using (exists (
    select 1 from public.social_clips c
    join public.profiles p on p.id = c.author_id
    where c.id = clip_id and c.status = 'approved' and p.is_public = true
  ));

create policy "Players like visible clips"
  on public.social_clip_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.social_clips c
      join public.profiles p on p.id = c.author_id
      where c.id = clip_id and c.status = 'approved' and p.is_public = true
    )
  );

create policy "Players remove own clip likes"
  on public.social_clip_likes for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "Players read visible clip comments"
  on public.social_clip_comments for select to authenticated
  using (
    (status = 'visible' and exists (
      select 1 from public.social_clips c
      join public.profiles p on p.id = c.author_id
      where c.id = clip_id and c.status = 'approved' and p.is_public = true
    ))
    or author_id = (select auth.uid())
    or coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'moderator'), false)
  );

create policy "Players comment on visible clips"
  on public.social_clip_comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'visible'
    and exists (
      select 1 from public.social_clips c
      join public.profiles p on p.id = c.author_id
      where c.id = clip_id and c.status = 'approved' and p.is_public = true
    )
  );

create policy "Players delete own clip comments"
  on public.social_clip_comments for delete to authenticated
  using (author_id = (select auth.uid()));

create policy "Moderators review clip comments"
  on public.social_clip_comments for update to authenticated
  using (coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'moderator'), false))
  with check (coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'moderator'), false));

create policy "Players submit clip reports"
  on public.social_clip_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (select 1 from public.social_clips c where c.id = clip_id and c.author_id <> (select auth.uid()))
  );

create policy "Players read own clip reports"
  on public.social_clip_reports for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'moderator'), false)
  );

create policy "Moderators update clip reports"
  on public.social_clip_reports for update to authenticated
  using (coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'moderator'), false))
  with check (coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'moderator'), false));

create policy "Moderators read moderation audit"
  on public.social_clip_moderation_actions for select to authenticated
  using (coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'moderator'), false));

create policy "Moderators append moderation audit"
  on public.social_clip_moderation_actions for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'moderator'), false)
  );

-- Moderators need a read path to pending/rejected/hidden clips and a constrained
-- update path for moderation fields. Ordinary players retain owner-only deletion.
create policy "Moderators read all clips"
  on public.social_clips for select to authenticated
  using (coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'moderator'), false));

create policy "Moderators update clip review state"
  on public.social_clips for update to authenticated
  using (coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'moderator'), false))
  with check (coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'moderator'), false));

grant select, insert, delete on public.social_clip_likes to authenticated;
grant select, insert, delete, update on public.social_clip_comments to authenticated;
grant select, insert, update on public.social_clip_reports to authenticated;
grant select, insert on public.social_clip_moderation_actions to authenticated;
grant update (status, reviewed_by, reviewed_at, moderation_note) on public.social_clips to authenticated;

-- Audit records are append-only: no UPDATE or DELETE grants/policies are created.
