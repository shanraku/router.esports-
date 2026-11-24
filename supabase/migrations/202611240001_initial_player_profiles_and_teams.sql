-- ROUTER.ESPORTS initial player and team data model.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  player_handle text not null unique,
  display_name text not null,
  avatar_path text,
  bio text,
  region text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_handle_format check (player_handle ~ '^[a-zA-Z0-9_]{3,24}$'),
  constraint profiles_display_name_length check (char_length(trim(display_name)) between 1 and 60),
  constraint profiles_bio_length check (bio is null or char_length(bio) <= 500)
);

create table public.profile_games (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  game_code text not null,
  game_uid text not null,
  in_game_name text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','pending','verified','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_games_unique_game_per_user unique (profile_id, game_code),
  constraint profile_games_game_code_length check (char_length(trim(game_code)) between 2 and 40),
  constraint profile_games_uid_length check (char_length(trim(game_uid)) between 2 and 100)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  team_name text not null,
  normalized_name text generated always as (lower(regexp_replace(trim(team_name), '\s+', ' ', 'g'))) stored,
  owner_id uuid not null references auth.users(id) on delete restrict,
  game_code text not null,
  description text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_name_length check (char_length(trim(team_name)) between 3 and 40),
  constraint teams_description_length check (description is null or char_length(description) <= 500),
  constraint teams_game_code_length check (char_length(trim(game_code)) between 2 and 40),
  constraint teams_normalized_name_unique unique (normalized_name)
);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('leader','member')),
  joined_at timestamptz not null default now(),
  constraint team_members_one_membership_per_user unique (user_id)
);

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled','expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  constraint team_invitations_not_self check (inviter_id <> invitee_id)
);

create table public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_join_requests_message_length check (message is null or char_length(message) <= 500)
);

create index profile_games_profile_id_idx on public.profile_games(profile_id);
create index teams_owner_id_idx on public.teams(owner_id);
create index team_members_team_id_idx on public.team_members(team_id);
create index team_invitations_invitee_status_idx on public.team_invitations(invitee_id, status);
create index team_join_requests_team_status_idx on public.team_join_requests(team_id, status);
create unique index team_members_one_leader_per_team_idx on public.team_members(team_id) where member_role = 'leader';
create unique index team_invitations_one_pending_idx on public.team_invitations(team_id, invitee_id) where status = 'pending';
create unique index team_join_requests_one_pending_idx on public.team_join_requests(team_id, requester_id) where status = 'pending';

alter table public.profiles enable row level security;
alter table public.profile_games enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invitations enable row level security;
alter table public.team_join_requests enable row level security;

create policy "Public profiles are visible" on public.profiles for select to anon, authenticated
using (is_public or (select auth.uid()) = id);
create policy "Players create own profile" on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);
create policy "Players update own profile" on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Verified game profiles are visible" on public.profile_games for select to anon, authenticated
using ((select auth.uid()) = profile_id or (
  verification_status = 'verified' and exists (
    select 1 from public.profiles p where p.id = profile_id and p.is_public = true
  )
));
create policy "Players add own game profile" on public.profile_games for insert to authenticated
with check ((select auth.uid()) = profile_id);
create policy "Players update own unverified game profile" on public.profile_games for update to authenticated
using ((select auth.uid()) = profile_id and verification_status in ('unverified','rejected'))
with check ((select auth.uid()) = profile_id and verification_status in ('unverified','rejected'));
create policy "Players delete own game profile" on public.profile_games for delete to authenticated
using ((select auth.uid()) = profile_id);

create policy "Public teams are discoverable" on public.teams for select to anon, authenticated
using (is_public or (select auth.uid()) = owner_id);
create policy "Players create teams for themselves" on public.teams for insert to authenticated
with check ((select auth.uid()) = owner_id);
create policy "Team owners update own team" on public.teams for update to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create policy "Visible team rosters" on public.team_members for select to anon, authenticated
using (
  exists (select 1 from public.teams t where t.id = team_id and (t.is_public or t.owner_id = (select auth.uid())))
  or user_id = (select auth.uid())
);
create policy "Team owner creates initial leader membership" on public.team_members for insert to authenticated
with check (user_id = (select auth.uid()) and member_role = 'leader' and exists (
  select 1 from public.teams t where t.id = team_id and t.owner_id = (select auth.uid())
));
create policy "Members may leave their own team" on public.team_members for delete to authenticated
using (user_id = (select auth.uid()) and member_role = 'member');
create policy "Team owner removes members" on public.team_members for delete to authenticated
using (member_role = 'member' and exists (
  select 1 from public.teams t where t.id = team_id and t.owner_id = (select auth.uid())
));

create policy "Participants can view team invitations" on public.team_invitations for select to authenticated
using (inviter_id = (select auth.uid()) or invitee_id = (select auth.uid()) or exists (
  select 1 from public.teams t where t.id = team_id and t.owner_id = (select auth.uid())
));
create policy "Team owners send invitations" on public.team_invitations for insert to authenticated
with check (inviter_id = (select auth.uid()) and exists (
  select 1 from public.teams t where t.id = team_id and t.owner_id = (select auth.uid())
));

create policy "Requesters and team owners view join requests" on public.team_join_requests for select to authenticated
using (requester_id = (select auth.uid()) or exists (
  select 1 from public.teams t where t.id = team_id and t.owner_id = (select auth.uid())
));
create policy "Players submit own join requests" on public.team_join_requests for insert to authenticated
with check ((select auth.uid()) = requester_id);

grant select on public.profiles, public.profile_games, public.teams, public.team_members to anon;
grant select, insert, update on public.profiles to authenticated;
grant select, delete on public.profile_games to authenticated;
grant insert (profile_id, game_code, game_uid, in_game_name) on public.profile_games to authenticated;
grant update (game_code, game_uid, in_game_name) on public.profile_games to authenticated;
grant select, insert, update on public.teams to authenticated;
grant select, insert, delete on public.team_members to authenticated;
grant select, insert on public.team_invitations to authenticated;
grant select, insert on public.team_join_requests to authenticated;
grant all on public.profiles, public.profile_games, public.teams, public.team_members, public.team_invitations, public.team_join_requests to service_role;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
