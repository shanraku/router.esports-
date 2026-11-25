# ROUTER.ESPORTS Database Schema & Security Plan

Status: Initial player/team schema applied and verified; Supabase-connected player auth, profile and core team UI committed; GitHub production build passed.
Target project: `router.esports` (Tokyo project currently visible in the user's screenshot).
Target region preference for any future replacement project: Mumbai (`ap-south-1`).
Do not delete or pause the existing Tokyo project while region/access decisions are unresolved.

## 1. Security principles

- Enable Row Level Security (RLS) on every table in the exposed `public` schema.
- Use `auth.uid()` for ownership checks. Never authorize with user-editable `user_metadata`.
- Keep admin authorization in trusted server-managed `app_metadata` or a protected role table; never let users assign themselves admin.
- Never put Supabase service-role or secret keys in browser code.
- Validate tournament eligibility, team leadership, roster limits, registrations, match results, rewards, and all balance changes on trusted server-side code.
- Keep paid scrims, payments, and reward payouts disabled until legal/compliance review and a compliant payment provider are ready.
- No betting, wagers, deposits-to-earn, or guaranteed reward claims.
- Do not seed fake players, tournaments, match results, leaderboards, rewards, or activity.

## 2. Proposed tables

### Identity and player profiles
- `profiles`: one row per `auth.users.id`; public display name, unique player handle, avatar path, bio, game identifiers, region, created/updated timestamps. Private contact details should be separated or access-restricted.
- `profile_games`: a player's game-specific profile/UID and verification state.

### Teams
- `teams`: team name, unique normalized name, owner/leader, game, description, status, timestamps.
- `team_members`: team/user membership, role (leader/member), join date; enforce one active team membership per user if product rules require it.
- `team_invitations`: inviter, invitee, team, status, expiry; only authorized team leaders can invite.
- `team_join_requests`: applicant, team, status, review metadata; only team leaders can approve/reject.

### Competition operations
- `tournaments`: title, game, format, rules, registration window, event schedule, capacity, status, visibility, published_by.
- `tournament_registrations`: tournament, player or team, registration status, timestamps; prevent duplicate registrations.
- `scrims`: practice session details, schedule, rules, capacity, status and any fee metadata (fees remain disabled until approved).
- `scrim_registrations`: scrim, player/team, status; prevent duplicate registrations.
- `matches`: tournament/scrim match, round, scheduled time, participants, status.
- `match_results`: match, submitted result, evidence reference, verification status, verified_by and audit timestamps. Players may submit evidence but cannot self-verify.

### Rankings and engagement
- `leaderboard_entries`: competition/season, player/team, verified points and rank inputs. Prefer deriving rankings from verified results rather than trusting client-supplied ranks.
- `achievements`: admin-defined achievement catalogue.
- `player_achievements`: earned achievement records, awarded by trusted server-side process.
- `missions`: admin-defined tasks with rules and active dates.
- `mission_progress`: per-user progress updated only by trusted, validated events.

### Rewards and money-related records
- `reward_campaigns`: campaign rules, dates, eligibility and status.
- `reward_claims`: user claim, review status, decision and timestamps.
- `reward_ledger`: append-only record of reward adjustments/awards, source reference and actor. Never accept client-written balances; derive balances from ledger entries or trusted server-side transactions.
- Payment tables/provider integration are intentionally deferred. No real-money collection or payout is enabled in this phase.

### Platform operations
- `notifications`: recipient, type, safe payload, read timestamp and created timestamp; users can read/update only their own notifications.
- `support_tickets`: owner, category, subject, message, status and timestamps; only owner and authorized support/admin staff can access.
- `announcements`: published notice, audience, author and schedule.
- `reports`: reporter, target type/id, reason, status and moderation metadata.
- `audit_logs`: append-only security/admin event records, written only by trusted server-side operations.

## 3. RLS policy matrix (design intent)

| Data | Anonymous | Authenticated player | Team leader | Trusted admin/service |
|---|---|---|---|---|
| Public profile fields | Read only if profile is public | Read public profiles; edit own allowed fields | Same as player | Moderation access as explicitly granted |
| Private account fields | No access | Own rows only | Own rows only | Restricted support/admin workflow |
| Teams and roster | Read public teams | Read public teams; request/join as allowed | Manage own team's roster/invites | Moderation |
| Invitations/join requests | No access | Own received/sent requests | Own team's requests | Moderation |
| Tournaments/scrims | Read published items | Register/unregister within rules | Register team if eligible | Create/publish/manage |
| Match results | Read verified/public results | Submit own evidence; cannot verify | Submit team evidence if authorized | Verify/reject with audit record |
| Leaderboards | Read published/verified data | No direct rank writes | No direct rank writes | Trusted result pipeline |
| Achievements/missions | Read active catalogue | Read own progress/awards | No direct award writes | Manage catalogue/award pipeline |
| Rewards/ledger | No access to private claims | Read own claims/ledger; no balance writes | No balance writes | Trusted reward processing |
| Notifications | No access | Read/update own notifications | Same | Send through trusted backend |
| Support tickets | No access | Create/read own tickets | Same | Assigned support/admin access |
| Announcements | Read published items | Read published items | Same | Create/publish |
| Reports | No access | Create/read own report status | Same | Moderation |
| Audit logs | No access | No access | No access | Restricted read; trusted append only |

## 4. Required database constraints and safeguards

- Foreign keys to `auth.users(id)` with deliberate delete behavior.
- Unique normalized player handles and team names.
- Check constraints for enumerated statuses and valid capacity/time ranges.
- Unique constraints to prevent duplicate tournament/scrim registrations and duplicate team membership.
- Team leader permissions enforced by database/server checks, not hidden UI controls alone.
- Result verification separated from result submission.
- Reward ledger append-only for client roles; no direct client update/delete.
- Audit events for admin actions, moderation, result verification, and reward decisions.
- Avoid SECURITY DEFINER functions unless a reviewed use case requires them; prefer SECURITY INVOKER and a non-exposed schema for privileged internals.
- If views are added, use `security_invoker = true` where supported and review grants/RLS.
- For every UPDATE policy, provide both `USING` and `WITH CHECK`, plus a compatible SELECT policy.

## 5. Implementation order

1. Confirm access to the ROUTER ESPORTS Supabase organisation and choose the project/region to retain.
2. Review current Supabase documentation and project settings.
3. Completed: create profiles and core team tables with constraints and RLS.
4. Pending: test policies using anonymous, player A, player B, team leader, and admin test identities.
5. Add tournament/scrim registration and result verification.
6. Add notifications, support, announcements, reports, audit logs.
7. Add reward catalogue and append-only ledger only after trusted server-side award processing is ready.
8. Run Supabase security advisors and verify the final policies before enabling frontend actions.

## 6. Current project status

The screenshot supplied by the user shows a project named `router.esports`, project ref `lrtjkxufvzrkecospgvq`, in the Tokyo region (`ap-northeast-1`) under an organisation labelled ROUTER ESPORTS. The connected Supabase integration can access this project. The six initial tables (`profiles`, `profile_games`, `teams`, `team_members`, `team_invitations`, `team_join_requests`) have been created with RLS, ownership policies, constraints and explicit grants. A restricted `create_team_with_leader` invoker function creates the team and first leader atomically. Game verification status is not writable by player clients. Security Advisor returned zero findings at the time of verification. The browser integration uses only the public publishable key; no service-role key is present in the frontend. The `/login`, `/profile`, and `/teams` routes now use Supabase Auth and live database queries. Profile save/game UID entry, team creation with first leader, public team discovery and join-request submission are wired. These UI flows require an authenticated player and a deployed build; no live production deployment has been performed by this change. Team invitation acceptance and join-request approval remain disabled pending secure workflow implementation.


## 7. Tournament foundation — applied

The following two tables are now applied to the ROUTER.ESPORTS Tokyo project:

- `tournaments`: event title, game code, solo/team format, description, rules, region, timezone, registration window, start time, draft/published/cancelled/completed status, visibility, creator and creation time.
- `tournament_registrations`: one player or one team per entry, registering account, registered/cancelled status and timestamp.

Security controls:
- RLS is enabled on both tables.
- Public/anonymous users can read only published public tournaments.
- Authenticated users can create their own drafts and edit/delete only their own drafts.
- The frontend cannot set a tournament to published; publication is reserved for a trusted admin/server workflow.
- Registrations require an open published event, matching solo/team format, matching game code and either the player's linked game profile or the team's leader membership.
- Team leaders can register/cancel their own team entry; players can register/cancel their own solo entry.
- Partial unique indexes prevent duplicate active player/team entries while allowing re-registration after cancellation.
- Private teams are allowed to register when the signed-in user is their leader.
- No capacity limit is currently advertised or enforced; capacity will be added with a transaction-safe trusted registration workflow.
- No payments, prize payouts, fake tournaments or fake registrations are enabled.

Frontend:
- `src/TournamentSpace.jsx` adds live public tournament discovery, signed-in tournament draft creation, solo/team registration and cancellation.
- `/tournaments` now routes to the connected tournament hub.
- Tournament hub styling is in `src/index.css`.
- Drafts are not publicly listed and cannot be self-published.

Verification:
- Both tournament tables are present and have RLS enabled.
- Expected SELECT/INSERT/UPDATE/DELETE policies were found in `pg_policies`.
- Security Advisor currently reports one warning: Supabase Auth leaked-password protection is disabled. Enable it in Auth password security settings before public launch.
- A real end-to-end registration test still requires at least one published tournament and a test player/team account. Do not claim this path has been production-tested yet.
- Supabase's Data API security guidance recommends explicit grants and RLS together; this migration grants only the required table/column privileges.
