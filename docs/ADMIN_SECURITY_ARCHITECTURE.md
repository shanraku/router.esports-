# ROUTER.ESPORTS — Admin Security Architecture

Status: design proposal only. No database objects, admin accounts, policies, or privileged functions have been created or enabled.

## 1. Security boundary

The current `/admin` route is a public, non-functional UI preview. Hiding a link or checking a browser-side role is not access control. Before launch, every administrative read and write must be authorized by the backend. A user must never gain admin access by editing local storage, React state, URL parameters, request bodies, or editable user metadata.

ROUTER.ESPORTS must use its own Supabase project. Do not reuse Mauqify or Global Open Source Hub projects. Project creation is intentionally pending until the owner selects the Supabase organization and reviews any quoted cost.

## 2. Identity and authorization

- Use Supabase Auth for identity; use a dedicated allowlist/role assignment process controlled by the project owner.
- Store authorization attributes in trusted `app_metadata` or a private database table, never `user_metadata` / `raw_user_meta_data` because users can edit those values.
- Prefer a private `private.admin_memberships` table as the source of truth, keyed by `user_id`, with role, status, granted_by, granted_at, and revoked_at.
- Define least-privilege roles such as `super_admin`, `tournament_moderator`, `support_agent`, and `trust_safety_reviewer`. Do not give every operator full access.
- Require MFA and an assurance level of AAL2 for every privileged action. Re-check assurance on the server for sensitive operations; do not rely only on a UI badge.
- Revocation must take effect promptly. For sensitive operations, verify the current membership/status server-side rather than relying only on potentially stale JWT claims.

## 3. Database layout (proposed)

Keep internal authorization and audit data in a non-exposed `private` schema.

### `private.admin_memberships`
- `user_id uuid primary key references auth.users(id)`
- `role text not null` with a constrained allowlist
- `status text not null` constrained to `active` / `revoked`
- `granted_by uuid references auth.users(id)`
- `granted_at timestamptz not null default now()`
- `revoked_at timestamptz null`

### `private.admin_audit_logs`
- `id uuid primary key default gen_random_uuid()`
- `actor_user_id uuid references auth.users(id)`
- `action text not null`
- `target_type text not null`
- `target_id text null`
- `reason text not null`
- `request_id text null`
- `outcome text not null`
- `created_at timestamptz not null default now()`
- Append-only for application operators. No client-side UPDATE or DELETE. Restrict reads to authorized roles and retain logs according to a published retention policy.

### Platform review records

Tournament moderation, user reports, match-result reviews, support cases, and announcements should live in their own domain tables. Each action should capture status, reviewer, timestamps, reason, and relevant evidence references. Avoid one broad admin table that grants unrelated access.

## 4. Access-control rules

- Enable RLS on every table in an exposed schema.
- Keep the `private` schema out of the Data API exposure list; grant no direct browser access to internal membership or audit tables.
- Use explicit `TO authenticated` policies plus ownership/role predicates where applicable. Authentication alone is not authorization.
- For UPDATE policies, use both `USING` and `WITH CHECK` to prevent changing ownership or privilege-bearing columns.
- Do not use editable user metadata or client-submitted role names for authorization.
- Do not create public `SECURITY DEFINER` functions as a shortcut around RLS. Prefer `SECURITY INVOKER`; if a narrowly scoped definer function is truly unavoidable, isolate it in a non-exposed schema, validate `auth.uid()`, restrict EXECUTE grants, and review it with database security advisors.
- Never put a Supabase service-role or secret key in Vite/browser code, GitHub, or public environment variables.

## 5. Privileged request flow

1. Admin signs in through Supabase Auth.
2. Backend verifies the session, current active membership, role permission, and AAL2 assurance.
3. Backend validates every input and target record; it ignores client-provided actor IDs, role claims, balances, scores, and approval states.
4. Backend performs the minimum permitted action.
5. Backend writes an audit event with actor, action, target, reason, request ID, timestamp, and outcome.
6. UI refreshes from the authorized response. Failed authorization returns a safe error and does not disclose private record existence.

Sensitive actions should require a reason and, where appropriate, a second-person review. Financial adjustments, account bans, result overrides, and role grants should have stronger approval controls.

## 6. Operational controls

- Keep production secrets in server-side secret storage only; rotate them if exposed.
- Protect the GitHub repository with reviewed changes and protected main branch settings where available.
- Use separate development and production environments.
- Back up the database and test restore procedures before launch.
- Monitor auth, database, and Edge Function logs; alert on repeated failed admin access and unusual privilege changes.
- Establish retention and deletion rules for reports, evidence, support records, and audit logs.
- Publish privacy, moderation, appeals, and contact processes before collecting real user data.

## 7. Implementation gates

Do not activate admin functionality until all gates pass:

1. Owner selects the correct Supabase organization and approves any non-zero project cost.
2. A dedicated ROUTER.ESPORTS Supabase project is created and confirmed healthy.
3. Schema and migrations are reviewed; RLS and grants are tested with anon, ordinary authenticated users, and each admin role.
4. MFA/AAL2 enforcement and role revocation are tested.
5. Privileged server functions validate permissions and write audit logs.
6. Negative tests prove ordinary users cannot read admin records or invoke admin actions.
7. A security review and backup/restore check are complete.

Until then, `/admin` remains a preview with disabled controls and no real data.
