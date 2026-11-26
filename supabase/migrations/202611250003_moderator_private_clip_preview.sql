-- ROUTER.ESPORTS: allow trusted moderators to create short-lived signed URLs
-- for private gameplay clips in the moderation queue. Does not make the bucket public.
-- Apply only after the engagement/moderation migrations have been reviewed.

create policy "router_clips_read_moderators_for_review"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'router-gameplay-clips'
    and coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'moderator'),
      false
    )
    and exists (
      select 1
      from public.social_clips c
      where c.storage_path = objects.name
        and c.status in ('pending', 'rejected', 'hidden')
    )
  );

comment on policy "router_clips_read_moderators_for_review" on storage.objects is
  'Allows trusted admin/moderator users to read only clips awaiting or requiring review; bucket remains private.';
