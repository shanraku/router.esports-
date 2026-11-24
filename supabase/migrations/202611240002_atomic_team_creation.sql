create or replace function public.create_team_with_leader(
  p_team_name text,
  p_game_code text,
  p_description text default null,
  p_is_public boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_team_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if char_length(trim(coalesce(p_team_name, ''))) not between 3 and 40 then
    raise exception 'Team name must be 3 to 40 characters' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_game_code, ''))) not between 2 and 40 then
    raise exception 'Choose a valid game' using errcode = '22023';
  end if;
  insert into public.teams (team_name, owner_id, game_code, description, is_public)
  values (trim(p_team_name), v_user_id, trim(p_game_code), nullif(trim(p_description), ''), coalesce(p_is_public, true))
  returning id into v_team_id;
  insert into public.team_members (team_id, user_id, member_role)
  values (v_team_id, v_user_id, 'leader');
  return v_team_id;
end;
$$;
revoke all on function public.create_team_with_leader(text,text,text,boolean) from public, anon;
grant execute on function public.create_team_with_leader(text,text,text,boolean) to authenticated;
