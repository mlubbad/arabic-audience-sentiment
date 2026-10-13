I found no critical or high-severity issues. No admin RPC can be reached by a non-admin, and the Edge Function checks the caller's own token before it uses the service-role key. The most serious problem is that one admin can take over another admin's account through the `admin-users` Edge Function. I modified nothing and ran only local reads (grep, plus one `node` evaluation of `csvCell`).

## Findings (most severe first)

**1. Medium: one admin can take over another admin's account (and any user's account) through `admin-users`**
- **Evidence:** `supabase/functions/_shared/admin-users.ts:138-139` only protects suspension: `if (action === "suspend" && (target.is_self || target.is_admin))`. `recovery_link` (lines 145-146) and `change_email` (line 155, `{ email: newEmail, email_confirm: true }`) have no admin check. The recovery link comes back to the caller in the response (line 172), and `AccountFile.tsx:387-421` shows it with a copy button. `AccountFile.tsx` never checks `is_admin`.
- **Exploit:** an admin, or anyone holding a stolen admin session, can:
  - change the platform owner's email to an address they control, with no confirmation step, then sign in through a recovery link and lock the owner out;
  - or simply open a recovery link to act as the other admin. Later actions are then recorded under the victim's name.
- **Also:** for an ordinary user, the hand-over link is a full owner-level session. That is far more than the read-only "log in as" view, yet it is recorded only as `password_link_created`.
- **Fix:** in `adminUserAction`, return 409 for `recovery_link`, `change_email` and `confirm_email` when `target.is_admin && !target.is_self`. Also consider emailing the link to the user instead of returning it.

**2. Medium: deleting a workspace erases its audit history, including admin actions**
- **Evidence:** `current.sql:7068` runs `delete from public.audit_events where workspace_id = w;`. The append-only guard deliberately allows this (`reject_review_mutation`, `current.sql:4326`).
- **What is lost:** `impersonation_started`/`ended`, `plan_set`, `pack_granted`, `channel_paused`, `auto_selection_set` and `channel_imported` rows on that workspace. Impersonation rows are pinned to the target's first membership (`current.sql:6663-6669`, `limit 1` with no `order by`), so deleting that workspace removes the record that an impersonation ever happened. Only `workspace_deleted` survives.
- **Fix:** set `workspace_id = null` on those rows instead of deleting them, the way `billing_events` is already handled (line 7043). The guard would need to allow that one update during the delete. Alternatively, write admin-action rows with `workspace_id null`.

**3. Low–medium: admin writes with no audit row (confirmed)**
- `set_plan_public_channels` (`current.sql:7615-7634`) only runs `update public.plans` and writes no audit row.
- `update_plan_limits` (`current.sql:8016-8138`) only runs `update public.plans … returning`. It also overwrites `allow_public_channels` from the dialog's state.
- `promote_platform_reader` (`current.sql:7385-7405`) copies a sealed OAuth grant into `private.platform_reader` and writes no audit row.
- **Risk:** plan-wide entitlement changes that affect every tenant on a plan leave no trace.
- **Fix:** insert into `audit_events` with `workspace_id null`, `target_type 'plan'` (or `'platform_reader'`) and `target_id = p_plan_key`.

**4. Low: `promote_platform_reader` is executable by PUBLIC, including anon**
- **Evidence:** `current.sql:9081`: `grant EXECUTE on function promote_platform_reader(uuid,uuid) to "public";`. The migration `20260919200000_a_platform_reader_reads_public_channels.sql:44-60` never revokes it.
- **Impact:** an internal `is_platform_admin()` check refuses anon, so it is not exploitable. It still breaks the rule that no admin function is executable by anon or public.
- **Fix:** `revoke all … from public, anon; grant execute … to authenticated;`

**5. Low: `grant_pack` can record a grant that never happened**
- **Evidence:** `current.sql:7091-7093` writes the audit row before calling `private.grant_units`. That function uses `on conflict on constraint usage_grants_source_provider_ref_key do nothing` and returns the existing id (lines 3355-3356). The constraint `UNIQUE (source, provider_ref)` (line 1035) applies across all workspaces.
- **Failure path:** reuse a pack note ("bonus") on workspace B after using it on workspace A. B gets nothing, the page says done, and the audit says `pack_granted` for B.
- **Fix:** scope the key by workspace (`w::text || ':' || note`), or raise an error when the existing grant belongs to another workspace. Write the audit row only when a grant is actually inserted.

**6. Low: impersonation is a client-side marker, and its audit is advisory**
- **Admins already see every workspace:** `private.has_role` gives admins viewer access everywhere (`current.sql:3402-3408`). They can read any workspace's dashboard without ever calling `admin_start_impersonation`, and those reads leave no trace.
- **No audit of workspace lookups:** `my_workspaces(target_user_id)` (lines 7331-7335) is admin-gated but writes no audit row.
- **Stop is unvalidated:** `admin_stop_impersonation` (lines 6678-6700) accepts any uuid, with no matching start and no check that the user exists, so it can write orphan `impersonation_ended` rows.
- **Start allows admins as targets:** only self is refused (line 6650). This grants nothing extra, because writes still need membership.
- **Visible to an unrelated owner:** the `impersonation_started` row can be read by that workspace's owner through the `owner_read` policy (line 8197).
- **What is fine:** nothing persists server-side after stop, and writes stay refused during impersonation.
- **Fix:** record impersonation rows with `workspace_id null`, and refuse a stop that has no open start.

**7. Low: `?demo` reaches live admin reads and writes**
- **Plans page:** `AdminPlansPage.tsx:41` sets `effectiveAdmin = admin || demo`. With `?demo=1` it loads the live catalogue (`planCatalogue.ts:60-66`), and the toggle and limits dialog call the live `set_plan_public_channels` and `update_plan_limits`. This skips the impersonation gate and shows no demo label (lines 300-306). Any failure is reported as `adminPlanToggleSuccess` (lines 72-76).
- **Other pages:** `useAdminShell` (`AdminShell.tsx:39-46`) returns `admin: true` for any `?demo`. Channels, Compare, Audit, Ops and System then issue live admin calls and show the live pause, collect and auto-selection buttons.
- **Impact:** the database refuses non-admins, so nothing leaks. The risk is an admin making real changes while believing they are in a demo.
- **Fix:** in demo mode, serve fixtures only and never call Supabase. Show the error on failure.

**8. Low: CSV formula neutralisation is incomplete**
- **Evidence:** `channelsConsole.ts:159` (`/^[=+\-@]/`), also used by `compareChannels.ts:215`.
  - A value starting with a tab or carriage return (e.g. `"\t=HYPERLINK(…)"`) passes through unneutralised.
  - Negative numbers are corrupted: `-12` becomes `'-12`, which breaks `net_sentiment` and `change_points`.
- **Who controls the input:** channel titles and handles come from any YouTube channel, and workspace names come from tenants.
- **Fix:** use `/^[=+\-@\t\r]/` and apply it to strings only, not numbers.

**9. Low: `admin_audit(null)` ignores the 1–500 limit**
- **Evidence:** `current.sql:5839`, `if p_limit < 1 or p_limit > 500`. A NULL makes the condition NULL, so the check is skipped and `limit null` returns every row. Admin-only.
- **Fix:** `if p_limit is null or p_limit not between 1 and 500`.

**10. Low: admin free-text notes are readable by tenants**
- `set_workspace_plan` stores `note` in `subscriptions.provider_ref` (`current.sql:7666-7678`). Any member, including viewers, can read it through `tenant_read` (line 8209).
- The pack note goes to `usage_grants.provider_ref`, readable through `usage_grants_read` (line 8214).
- **Fix:** keep notes in the audit trail or a private table, or label the field as visible to the customer.

**11. Low: audit rows for Edge Function actions are not proof the action happened**
- `admin-users` writes its audit row after the side effect, in a separate request. If that write fails the action still stands (`recorded:false`, `admin-users.ts:162-169`).
- Separately, `admin_record_user_action` (`current.sql:6293-6316`) can be called directly to record actions that never happened. Admins are trusted, but these rows are not evidence.

**12. Info (outside the console): `share_workspace`**
- **Email-existence oracle:** any workspace owner can probe whether an email is registered. The user lookup (`current.sql:7726`, `user_not_found`) runs before the member-limit check (line 7752, `members_limit_reached`), so a workspace at its limit can probe without adding anyone.
- **Admin self-grant:** the `is_admin` branch lets an admin add themselves as analyst to any workspace, which gives write access. This is audited as `workspace_shared`.

**13. Info:** the tracked test `apps/web/src/account/Account.impersonation.test.tsx:161` contains a real-looking Gmail address (not repeated here). It may be a real account; replace it with an `example.com` address.

## Checked and found correct
- **Admin RPC definitions:** every public admin RPC is SECURITY DEFINER with `search_path=''` and fully qualified names. The admin check is the first statement, before any read or write, in every one. A null `auth.uid()` fails `is_platform_admin()`. No function returns data before the check, and none uses dynamic SQL or LIKE.
- **`update_workspace_account_role`:** the documented exception (`is_admin or has_role(w, ['workspace_owner'])`) is correct, cannot touch the owner's seat, and is audited.
- **Grants:** all admin RPCs except `promote_platform_reader` are granted only to `authenticated` and `postgres`.
  - `private.admin_channel_states`, `record_admin_digest` and `build_admin_digest` are executable only by `postgres`.
  - `private.has_role` is executable by `authenticated`, but row-level security needs that and it only answers about the caller.
- **Private tables:** `admin_digests`, `platform_admins`, `user_profiles` and the OAuth tables have no grants to `anon` or `authenticated`. `channel_lookup_reader_grant` was hardened to `service_role` (migration `20260929000000`). `connection_status` is `security_invoker`.
- **Data returned:** no admin RPC returns tokens, credential hashes or OAuth grants. Emails, phone numbers and admin notes go only to admin pages that display them.
- **Input bounds:**
  - `admin_set_channels_paused` and `admin_request_channel_work` are capped at 500 ids.
  - `admin_set_auto_selection` limits are capped at 0–200 and 0–100.
  - `admin_import_channel` validates the channel id against `^UC…{22}$`, and table constraints bound its counts.
  - `set_workspace_plan` caps months at 1–1200, and a NULL is caught by NOT NULL.
  - `update_plan_limits` values are bounded by CHECK constraints.
- **`admin-users` Edge Function:**
  - The caller's token is checked through `admin_user_target` before any service-role call.
  - The origin allow-list protects `recovery_link`, and suspending self or another admin is blocked.
  - The user id is validated as a UUID and the email by regex.
  - CORS uses an allow-list.
  - Nothing is logged, and no secrets are embedded in `apps/web/src` or `supabase/functions` (only test placeholders).
- **Audits:** every other console write writes an audit row, and the append-only guard on `audit_events` exists (`20260913170000_catalogue_tables.sql:56`).