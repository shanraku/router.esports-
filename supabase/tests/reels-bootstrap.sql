-- Minimal Supabase-compatible schema for isolated Reels migration tests.
-- This database exists only inside a disposable GitHub Actions runner.

create schema if not exists auth;
create schema if not exists private;
create schema if not exists storage;

do $$
begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;

do $$
begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;

create table auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  is_public boolean not null default true
);

create table public.social_clips (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  caption text,
  game_code text,
  duration_seconds numeric not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table private.social_clip_view_events (
  clip_id uuid not null references public.social_clips(id) on delete cascade,
  viewer_id uuid not null,
  valid_watch_seconds numeric not null default 0
);

create table storage.objects (
  name text primary key,
  bucket_id text not null
);

alter table storage.objects enable row level security;
grant select on storage.objects to authenticated;

-- The storage RLS policy evaluates public.social_clips while the test role is
-- authenticated. Supply the table-level privilege here so RLS can determine
-- whether the moderator is allowed to read the object.
grant select on public.social_clips to authenticated;
