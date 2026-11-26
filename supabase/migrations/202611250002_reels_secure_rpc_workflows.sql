-- ROUTER.ESPORTS Reels: RPC-only writes for moderation, atomic audit, public counters.
-- Requires migration 202611250001_reels_engagement_and_moderation.sql.
-- Moderator authority is trusted app_metadata only; never user-editable user_metadata.

-- Remove direct moderation mutation paths. All moderation changes go through
-- moderate_social_clip(), which validates role, locks the target, updates it,
-- and appends the audit event in one transaction.
revoke all on public.social_clip_moderation_actions from anon, authenticated;
revoke update, delete on public.social_clip_reports from anon, authenticated;
revoke update on public.social_clip_comments from anon, authenticated;
revoke update on public.social_clips from authenticated;

grant select on public.social_clip_moderation_actions to authenticated;
grant select, insert on public.social_clip_reports to authenticated;
grant select, insert, delete on public.social_clip_comments to authenticated;

-- Do not permit clients to forge audit rows, including as a moderator.
drop policy if exists "Moderators append moderation audit" on public.social_clip_moderation_actions;

create or replace function public.toggle_social_clip_like(p_clip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_liked boolean;
  v_count bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform 1
    from public.social_clips c
    join public.profiles p on p.id = c.author_id
   where c.id = p_clip_id
     and c.status = 'approved'
     and p.is_public = true;
  if not found then
    raise exception 'Clip is not available' using errcode = 'P0002';
  end if;

  delete from public.social_clip_likes
   where clip_id = p_clip_id and user_id = v_user_id;

  if not found then
    insert into public.social_clip_likes (clip_id, user_id)
    values (p_clip_id, v_user_id)
    on conflict (clip_id, user_id) do nothing;
    v_liked := true;
  else
    v_liked := false;
  end if;

  select count(*) into v_count
    from public.social_clip_likes where clip_id = p_clip_id;

  return jsonb_build_object('liked', v_liked, 'like_count', v_count);
end;
$$;

create or replace function public.get_social_clip_stats(p_clip_id uuid)
returns table (view_count bigint, like_count bigint, comment_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.social_clips c
    join public.profiles p on p.id = c.author_id
    where c.id = p_clip_id and c.status = 'approved' and p.is_public = true
  ) then
    raise exception 'Clip is not available' using errcode = 'P0002';
  end if;

  return query
  select
    (select count(distinct e.viewer_id)::bigint
       from private.social_clip_view_events e
      where e.clip_id = p_clip_id
        and e.valid_watch_seconds > 0),
    (select count(*)::bigint from public.social_clip_likes l where l.clip_id = p_clip_id),
    (select count(*)::bigint from public.social_clip_comments c
      where c.clip_id = p_clip_id and c.status = 'visible');
end;
$$;

create or replace function public.moderate_social_clip(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text := auth.jwt() -> 'app_metadata' ->> 'role';
  v_clip_id uuid;
  v_comment_id uuid;
  v_report_id uuid;
  v_status text;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if coalesce(v_role, '') not in ('admin', 'moderator') then
    raise exception 'Moderator permission required' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 or char_length(p_reason) > 1000 then
    raise exception 'A reason between 3 and 1000 characters is required';
  end if;

  if p_target_type = 'clip' then
    if p_action not in ('approve_clip','reject_clip','hide_clip','restore_clip','remove_clip') then
      raise exception 'Invalid clip moderation action';
    end if;
    select c.id into v_clip_id from public.social_clips c
      where c.id = p_target_id for update;
    if not found then raise exception 'Clip not found' using errcode = 'P0002'; end if;

    v_status := case p_action
      when 'approve_clip' then 'approved'
      when 'reject_clip' then 'rejected'
      when 'hide_clip' then 'hidden'
      when 'restore_clip' then 'approved'
      when 'remove_clip' then 'removed'
    end;

    update public.social_clips
       set status = v_status, reviewed_by = v_actor,
           reviewed_at = now(), moderation_note = btrim(p_reason)
     where id = v_clip_id;

  elsif p_target_type = 'comment' then
    if p_action not in ('hide_comment','restore_comment') then
      raise exception 'Invalid comment moderation action';
    end if;
    select c.id, c.clip_id into v_comment_id, v_clip_id
      from public.social_clip_comments c where c.id = p_target_id for update;
    if not found then raise exception 'Comment not found' using errcode = 'P0002'; end if;

    update public.social_clip_comments
       set status = case p_action when 'hide_comment' then 'hidden' else 'visible' end,
           updated_at = now()
     where id = v_comment_id;

  elsif p_target_type = 'report' then
    if p_action not in ('resolve_report','dismiss_report') then
      raise exception 'Invalid report moderation action';
    end if;
    select r.id, r.clip_id into v_report_id, v_clip_id
      from public.social_clip_reports r where r.id = p_target_id for update;
    if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;

    update public.social_clip_reports
       set status = case p_action when 'resolve_report' then 'resolved' else 'dismissed' end,
           reviewed_by = v_actor, reviewed_at = now(), resolution_note = btrim(p_reason)
     where id = v_report_id;
  else
    raise exception 'Invalid moderation target type';
  end if;

  insert into public.social_clip_moderation_actions
    (clip_id, comment_id, report_id, actor_id, action, reason)
  values
    (v_clip_id, v_comment_id, v_report_id, v_actor, p_action, btrim(p_reason));

  return jsonb_build_object(
    'ok', true, 'target_type', p_target_type,
    'target_id', p_target_id, 'action', p_action, 'status', v_status
  );
end;
$$;

revoke all on function public.toggle_social_clip_like(uuid) from public, anon;
revoke all on function public.get_social_clip_stats(uuid) from public, anon;
revoke all on function public.moderate_social_clip(text, uuid, text, text) from public, anon;
grant execute on function public.toggle_social_clip_like(uuid) to authenticated;
grant execute on function public.get_social_clip_stats(uuid) to anon, authenticated;
grant execute on function public.moderate_social_clip(text, uuid, text, text) to authenticated;

-- The public counter RPC only returns aggregates for approved clips whose
-- creator profile is public. Raw private view events remain inaccessible.
