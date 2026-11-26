-- Reels security integration checks against disposable local PostgreSQL.
\set ON_ERROR_STOP on

insert into auth.users (id)
values ('11111111-1111-4111-8111-111111111111');

insert into public.profiles (id, is_public)
values ('11111111-1111-4111-8111-111111111111', true);

insert into public.social_clips (
  id, author_id, storage_path, caption, game_code, duration_seconds, status
)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111/test.mp4',
  'CI security fixture',
  'test-game',
  15,
  'pending'
);

-- A signed-in user with no trusted app_metadata role must not moderate.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","app_metadata":{}}',
  false
);
set role authenticated;

do $$
begin
  begin
    perform public.moderate_social_clip(
      'clip',
      '22222222-2222-4222-8222-222222222222',
      'approve_clip',
      'Unauthorized CI test'
    );
    raise exception 'SECURITY TEST FAILED: user without moderator role was allowed to moderate';
  exception
    when insufficient_privilege then
      null;
  end;
end $$;

-- Trusted moderator claim may perform the action through the RPC.
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","app_metadata":{"role":"moderator"}}',
  false
);

select public.moderate_social_clip(
  'clip',
  '22222222-2222-4222-8222-222222222222',
  'approve_clip',
  'Approved by isolated CI test'
);

-- Like toggle is available to authenticated users and writes atomically.
select public.toggle_social_clip_like('22222222-2222-4222-8222-222222222222');

-- Seed the private storage object as the database owner. The authenticated
-- role must not be granted INSERT on storage.objects just for this test.
reset role;
insert into storage.objects (name, bucket_id)
values ('11111111-1111-4111-8111-111111111111/test.mp4', 'router-gameplay-clips');

-- The ordinary authenticated user cannot read the private pending clip object.
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","app_metadata":{}}',
  false
);
set role authenticated;
do $$
begin
  if (select count(*) from storage.objects) <> 0 then
    raise exception 'SECURITY TEST FAILED: ordinary user can read private review clip';
  end if;
end $$;

-- A trusted moderator can read the pending clip object for review.
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","app_metadata":{"role":"moderator"}}',
  false
);
do $$
begin
  if (select count(*) from storage.objects) <> 1 then
    raise exception 'SECURITY TEST FAILED: moderator cannot read pending review clip';
  end if;
end $$;

reset role;

do $$
begin
  if (select status from public.social_clips
      where id = '22222222-2222-4222-8222-222222222222') <> 'approved' then
    raise exception 'Moderation RPC did not update clip status';
  end if;

  if (select count(*) from public.social_clip_moderation_actions
      where clip_id = '22222222-2222-4222-8222-222222222222') <> 1 then
    raise exception 'Moderation RPC did not write exactly one audit event';
  end if;

  if (select count(*) from public.social_clip_likes
      where clip_id = '22222222-2222-4222-8222-222222222222'
        and user_id = '11111111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'Like RPC did not persist the like';
  end if;
end $$;

select 'Reels migration and security tests passed' as result;
