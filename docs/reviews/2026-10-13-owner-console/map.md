I've mapped the six sections end to end: routes, reads and writes, database functions, background jobs, tests and strings. The database side is checked against `supabase/schema/current.sql`, which is generated from all the migrations, and the migration that last defines each function is named alongside. Paths below are relative to `/home/user/arabic-audience-sentiment`.

**Problems found along the way:**
- **Plans page shows success after a failed save.** If `set_plan_public_channels` fails on the live site, the error is caught, the toggle is flipped locally anyway, and the page shows `adminPlanToggleSuccess` (`apps/web/src/admin/AdminPlansPage.tsx:72-76`).
- **Plan-limits dialog shows a raw code on failure.** `updatePlanLimits` throws an error whose message is `live_unavailable` (`apps/web/src/data.ts:256`). `EditPlanLimitsDialog.tsx:117-119` prints that message, so the friendly `adminPlanLimitsUpdateFailed` text never appears for a database refusal.
- **Two plan writes leave no audit trail.** `set_plan_public_channels` and `update_plan_limits` change the `plans` table but write nothing to `audit_events`.
- **Five of the console's own actions have no readable label.** `plan_set`, `pack_granted`, `workspace_deleted`, `user_marked_test` and `user_unmarked_test` are missing from `adminAccountActions` in both `ar.ts` and `en.ts`. Home activity, the System audit card and account history show the raw code instead.
- **One Edge Function refusal is misreported.** `admin-users` can answer `invalid_origin` (`_shared/admin-users.ts:234`). The client doesn't list that code (`adminRead.ts:140-147`), so the page shows the generic "unavailable" sentence.

---

## 1. Navigation and the access gate

**How the console is reached**
- **Rail link:** one rail entry, `/admin` labelled `navAdmin` (`apps/web/src/main.tsx:257-263`). It is shown only when `useIsPlatformAdmin(session).data === true && !isImpersonating` (`main.tsx:325-328`).
- **Routes:** all lazy-loaded, declared at `main.tsx:546-556`.
- **Tab strip:** `AdminTabs` in `admin/AdminShell.tsx:88-95` lists the six sections. «النظام» stays highlighted on any of its sub-pages (`SYSTEM_PATHS`, `AdminShell.tsx:99-108,126`).
- **Back link:** System sub-pages show `adminSystemBack` (`AdminShell.tsx:162-169`).
- **Ctrl/⌘K search:** `AdminCommandPalette` is mounted in the tab strip when not in demo mode (`AdminShell.tsx:139`). It lists 11 pages (`AdminCommandPalette.tsx:27-39`), plus channels and accounts once opened.

| Section | Path | Component |
|---|---|---|
| الرئيسية | `/admin` | `AdminHomePage` (with `?demo` it redirects to `/admin/workspaces?demo=1`, `AdminHomePage.tsx:47`) |
| مساحات العمل | `/admin/workspaces` | `AdminPage` |
| الحسابات | `/admin/users` | `AdminUsersPage`, which opens the `AccountFile` side panel |
| القنوات | `/admin/channels` | `AdminChannelsPage` |
| المقارنة | `/admin/compare` | `AdminComparePage` |
| النظام | `/admin/system` | `AdminSystemPage`: five cards linking to `/admin/services`, `/admin/ops`, `/admin/plans`, `/admin/import`, `/admin/audit` (`AdminSystemPage.tsx:76-100`) |

**Who is allowed in (client side)**
- `useIsPlatformAdmin` calls the RPC `is_platform_admin` with query key `["is_admin", userId]` (`apps/web/src/adminAccess.ts:14-25`).
- `useAdminShell` (`AdminShell.tsx:34-86`) grants access when `demo || (!isImpersonating && !!(session && access.data === true))` (lines 45-46). Its states:
  - Loading: `pageOpening`.
  - Error: `LoadError` with `serviceUnreachable`.
  - Not allowed: `adminEyebrow` / `adminTitle` / `adminForbidden` (testid `admin-forbidden`).
- `AdminPage` has its own copy of the gate: `!demo && !isImpersonating && access.data === true` (`AdminPage.tsx:126`). It shows the forbidden card without tabs (lines 170-190).
- `AdminPlansPage` lets `?demo=1` through without the gate (`effectiveAdmin = admin || demo`, `AdminPlansPage.tsx:41`, rendered at 300-307).
- The real gate is the database: `is_platform_admin()` is `exists (select 1 from private.platform_admins where user_id = auth.uid())` (`current.sql:7264`).

## 2. Each section: reads, writes, schema, UI states

All `read*` helpers are in `apps/web/src/admin/adminRead.ts`. Read failures become `DashboardRpcError("live_unavailable", {code…})` (lines 47-58).

**الرئيسية (`AdminHomePage.tsx`)**
- **Reads:**
  - `admin_console_overview` (`adminRead.ts:208`), parsed with `AdminConsoleOverviewSchema` (`packages/contracts/src/admin.ts:192`). Query key `["admin","overview"]` (`AdminHomePage.tsx:42-46`).
  - `admin_daily_digest` (`adminRead.ts:233`), parsed with `AdminDailyDigestSchema` (`contracts/admin.ts:400`), shaped by `dailyDigest.ts:38`.
- **UI states (overview):**
  - Loading: `adminHomeLoading`.
  - Error: `serviceUnreachable` plus a failure code.
  - Empty lists: `adminHomeAttentionEmpty`, `adminHomeActivityEmpty`.
- **UI states (morning summary):**
  - While loading it renders nothing (line 226).
  - Error: `adminDigestUnavailable`.
  - No snapshot: `adminDigestNone`.
  - First snapshot: `adminDigestFirst`; otherwise `adminDigestRecorded`.
  - `adminDigestNoneFailing`, `adminDigestNoMovers`.
- **Links out:** state counts go to `/admin/channels?state=…`; each attention item opens `/dashboard?ws=…`.
- **Writes:** none.

**مساحات العمل (`AdminPage.tsx` + `WorkspaceRow.tsx` + `DeleteWorkspaceDialog.tsx`)**
- **Reads:**
  - `admin_workspaces` (`AdminPage.tsx:53`), parsed with `AdminWorkspacesSchema` (`contracts/admin.ts:21`).
  - `admin_plan_catalogue` (`planCatalogue.ts:67`), parsed with `PlanCatalogueSchema` (`contracts/plans.ts:33`).
  - `admin_workspace_footprint`, counted when the delete dialog opens (`DeleteWorkspaceDialog.tsx:35`). No zod schema; it is cast.
- **Writes** (`callServer`, `AdminPage.tsx:63-83`): `set_workspace_plan`, `grant_pack`, `delete_workspace`.
- **UI states:**
  - Loading: `adminLoading`.
  - Error: `adminErrorMessage` (`adminWords.ts:89-103`), which maps `forbidden`, `paddle_subscription_active`, `billing_root`, `last_workspace`, else `adminFailed(code)`.
  - Empty: `adminEmpty`.
  - Per row while working: `working`; on success `adminDone` plus a toast.
- **Demo:** `?demo=1` loads a fixture and replays actions through `reduceAdminDemo`.

**الحسابات (`AdminUsersPage.tsx`, `AccountFile.tsx`)**
- **List:** `admin_accounts` (`adminRead.ts:281`), parsed with `AdminAccountsSchema` (`contracts/admin.ts:304`).
  - Loading: `adminUsersLoading`. Error: `serviceUnreachable`.
  - Empty: `adminUsersEmpty`. No match: `adminAccountsEmpty`.
  - `?u=<id>` opens that person's file (lines 117-125).
  - "Log in as" calls `admin_start_impersonation` (`impersonation.tsx:79`), then `my_workspaces(target_user_id)` (line 108). Exiting calls `admin_stop_impersonation` (line 156).
- **Account file reads:**
  - `admin_user_detail(p_user)` (`adminRead.ts:70`), parsed with `AdminUserDetailSchema` (`contracts/admin.ts:47`).
    - Loading: `adminAccountLoading`. Error: `adminAccountLoadFailed`.
    - Empty: `adminAccountWorkspacesNone`, `adminAccountHistoryEmpty`.
  - The plans section reuses `admin_workspaces` and `admin_plan_catalogue`, filtered client-side by `created_by` (`AccountFile.tsx:679-684`).
    - Loading: `adminLoading`. Error: generic `LoadError`. Empty: `adminAccountPlansNone`.
- **Account file writes:**

| Action | Call | Success / failure text |
|---|---|---|
| Save details | `admin_update_user_profile` (`adminRead.ts:91`) | `adminAccountSaved` / `adminAccountTooLong` / `adminAccountSaveFailed` |
| Mark as test account | `admin_set_user_test` (`adminRead.ts:291`) | failure: `adminAccountTestFailed` |
| Send reset email | `auth.resetPasswordForEmail`, then `admin_record_user_action('password_reset_sent')` (`adminRead.ts:109-117`) | `adminAccountResetSent` / `adminAccountResetFailed` |
| Hand-over link, suspend, unsuspend, confirm email, change email | `fetch …/functions/v1/admin-users` (`adminRead.ts:153-189`) | errors from `adminAccountActionErrors[code]`; `adminAccountNotRecorded` appended if the audit row failed |
| Change a member's role | `update_workspace_account_role` (`adminRead.ts:198`) | failure: `adminAccountRoleFailed` |
| Plan levers | same as Workspaces (`LiveWorkspaces`) | same as Workspaces |

**القنوات (`AdminChannelsPage.tsx`, `channelsConsole.ts`)**
- **Read:** `admin_channels_console` (`adminRead.ts:217`), parsed with `AdminChannelsConsoleSchema` (`contracts/admin.ts:279`).
  - Loading: `adminChannelsLoading`. Error: `serviceUnreachable`.
  - Empty: `adminChannelsEmpty`. No match: `adminConsoleEmpty`.
  - Filters live in the address: `?state&owner&q&sort`.
- **Writes:**
  - Pause/resume one or many: `admin_set_channels_paused` (`adminRead.ts:243`). Text: `adminConsolePausedDone` / `adminConsoleResumedDone` / `adminConsolePauseFailed`; bulk uses `adminBulkPaused` / `adminBulkResumed`.
  - Bulk collect / catalogue: `admin_request_channel_work` (`adminRead.ts:256`), text `adminBulkQueued`.
  - Bulk auto-selection: `admin_set_auto_selection` (`adminRead.ts:270`), text `adminBulkAutoDone`.
  - Any bulk failure: `adminBulkFailed`.
  - CSV export happens in the browser only.
- **Entering a workspace** saves the shown list to sessionStorage `admin-trail:v1` (`adminTrail.ts:14,36`), which the workspace pages read for previous/next.

**المقارنة (`AdminComparePage.tsx`, `compareChannels.ts`)**
- **Read:** `admin_channels_compare` (`adminRead.ts:226`), parsed with `AdminChannelsCompareSchema` (`contracts/admin.ts:347`).
  - Loading: `adminCompareLoading`. Error: `serviceUnreachable`.
  - Empty: `adminChannelsEmpty`. No match: `adminConsoleEmpty`.
  - A card with nothing to show: `adminCompareNoneYet`.
  - Too few comments (`MIN_SAMPLE = 20`): `adminCompareSmall`.
  - "Pending" (`refreshed_at` is null): `adminCompareNotCounted(n)` (lines 96, 182).
  - Freshness line: `adminCompareRefreshed(max refreshed_at)` (line 243).
- **Writes:** none (CSV only).

**النظام (`AdminSystemPage.tsx`)**
- Reads `admin_services_health`, turned into a report by `buildLiveServicesReport` and checked against `ServicesHealthReportSchema` (`contracts/servicesHealth.ts:67`).
- Reads `admin_audit(100)` with `AdminAuditEventsSchema` (`contracts/admin.ts:173`).
- Failure on either card: `adminSystemUnread`. Empty audit: `adminHomeActivityEmpty`.

**System sub-pages**

| Page | Read / write | UI states |
|---|---|---|
| `/admin/services` | `admin_services_health` (`adminRead.ts:554`), auto-refresh interval stored in localStorage `sentiment_admin_health_refresh_interval` | Loading `adminServicesLoading`; error `serviceUnreachable`; `adminServicesEmpty` (shown only if no report, which can't happen after a success); while fetching `adminServicesRefreshing` |
| `/admin/ops` | `admin_ops` (`adminRead.ts:305`), `AdminOpsSchema` (`contracts/admin.ts:140`) | `adminOpsLoading`; `serviceUnreachable`; `adminOpsFailedEmpty` |
| `/admin/audit` | `admin_audit(100 / 300 / 500)` (`adminRead.ts:318`) | `adminAuditLoading`; `serviceUnreachable`; `adminAuditEmpty`. Shows the raw `action` with no translation (`AdminAuditPage.tsx:92`) |
| `/admin/plans` | Reads `admin_plan_catalogue`. Writes `set_plan_public_channels` (`adminRead.ts:329`) and `update_plan_limits` (`adminRead.ts:340`, from `EditPlanLimitsDialog.tsx:101`) | `adminPlansLoading`; `serviceUnreachable`; `adminPlansEmpty`; success `adminPlanToggleSuccess` / `adminPlanLimitsUpdated`; bad input `adminPlanLimitsInvalid`. Both failure paths are broken (see the top of this report) |
| `/admin/import` | `my_workspaces` (`AdminImportPage.tsx:57`); the `channel-lookup` Edge Function (line 146), checked with `ChannelLookupResponseSchema`; `admin_import_channel` (line 190), checked with `AdminImportResultSchema` (`contracts/channelLookup.ts:24,35`). Rows kept in localStorage `admin-channel-import:v1` | `pageOpening`; `serviceUnreachable`; `adminImportNoHome`; `adminImportDemo`; pending `adminImportSearching` / `adminImportRunning`; `adminImportQuotaHalted`; `adminImportFailed(code)` |

**Command palette** reads `admin_channels` (`AdminChannelsSchema`) and `admin_users` (`AdminUsersSchema`) only once opened. Loading: `adminSearchLoading`. Empty: `adminSearchEmpty`.

## 3. Database functions

All of these are SECURITY DEFINER with `search_path = ''`. Every public one is revoked from `public` and `anon` and executable by `authenticated` (plus the owner `postgres`), per the grants at `current.sql:8978-9172`. Unless the "Authorization" column says otherwise, the check is `if not public.is_platform_admin() then raise 'forbidden'`, and "uid+admin" means `uid is null or not is_platform_admin()`.

| Function | Last defined in | Timeout | Authorization | Writes / audit row |
|---|---|---|---|---|
| `is_platform_admin` | `20260917030000_platform_admin.sql:9` | – | (is the check) | – |
| `admin_workspaces` | `20260917030000_platform_admin.sql:79` | – | admin | – |
| `grant_pack` | `20260917030000_platform_admin.sql:95` | – | admin | `pack_granted` |
| `set_workspace_plan` (5 args) | `20260917060000_cancel_drops_to_free.sql:255` | – | admin; refuses an active Paddle plan unless `override` | `plan_set` |
| `admin_plan_catalogue` | `20260917070000_pilot_is_founding_partner.sql:11` | – | admin | – |
| `delete_workspace` | `20260917100000_delete_workspace.sql:105` | – | admin; refuses `last_workspace`, `billing_root`, active Paddle | `workspace_deleted`, recorded on the admin's own home workspace |
| `admin_workspace_footprint` | `20260917100000_delete_workspace.sql:66` | – | admin | – |
| `admin_users`, `admin_ops` | `20260919160000_admin_observability.sql:13 / 69` | – | admin | – |
| `update_workspace_account_role` | `20260921140000_workspace_sharing_and_admin_oversight.sql:189` | – | `is_admin or private.has_role(w, ['workspace_owner'])` | `workspace_account_role_updated` |
| `set_plan_public_channels` | `20260922160000_plan_public_channels_access.sql:32` | – | admin | **none** |
| `admin_audit` | `20260922170000_user_impersonation_and_workspace_isolation.sql:10` | – | admin; limit must be 1–500 | – |
| `admin_start_impersonation` / `admin_stop_impersonation` | same file, `:63` / `:106` | – | admin; start refuses self | `impersonation_started` / `impersonation_ended` |
| `my_workspaces` | same file, `:32` | – | admin only when `target_user_id` is given | – |
| `update_plan_limits` | `20261001010000_unlimited_plan_overflow_and_job_retries.sql:10` | – | admin | **none** |
| `admin_channels` | `20261006000000_admin_collection_freshness.sql:3` | – | admin | – |
| `admin_services_health` | `20261010000000_admin_services_health_records.sql:3` | – | admin | – |
| `admin_import_channel` | `20261012000000_admin_import_channel.sql:181` | – | uid+admin | `channel_imported` |
| `admin_update_user_profile` | `20261014000000_admin_account_file.sql:97` | – | uid+admin | `user_profile_updated` |
| `admin_record_user_action` | `20261015000000_admin_user_actions.sql:38` | – | uid+admin; only six allowed action names | the action itself |
| `admin_user_target` | `20261015000000_admin_user_actions.sql:15` | – | uid+admin | – |
| `admin_channels_console` | `20261017000000_admin_channels_console.sql:16` | 30s | uid+admin | – |
| `admin_set_channels_paused` | `20261018000000_channel_pause.sql:28` | – | uid+admin | `channel_paused` / `channel_resumed`; cancels queued jobs |
| `admin_console_overview` | `20261018000000_channel_pause.sql:239` (grant at `20261016…:139-140`) | 30s | admin | – |
| `private.admin_channel_states` | `20261018000000_channel_pause.sql:189` | – | none of its own; only `postgres` can execute it (`current.sql:8764`) | – |
| `admin_request_channel_work` | `20261019000000_admin_bulk_channel_actions.sql:24` | – | uid+admin | `channel_collect_requested` / `channel_catalogue_requested` |
| `admin_set_auto_selection` | `20261019000000_admin_bulk_channel_actions.sql:78` | – | uid+admin | `auto_selection_set` |
| `admin_accounts` | `20261020000000_admin_accounts.sql:54` | 30s | admin | – |
| `admin_set_user_test` | `20261020000000_admin_accounts.sql:24` | – | uid+admin | `user_marked_test` / `user_unmarked_test` |
| `admin_user_detail` | `20261020000000_admin_accounts.sql:117` (grant at `20261014…:92-93`) | – | admin | – |
| `admin_channels_compare` | `20261021000000_admin_channels_compare.sql:253` | 30s | uid+admin | – |
| `admin_daily_digest` | `20261022000000_admin_daily_digest.sql:120` | 30s | admin | – |
| `private.record_admin_digest` | `20261022000000_admin_daily_digest.sql:99` | 120s | cron only; `postgres` execute only (`current.sql:8863`) | – |

**The `admin-users` Edge Function**
- `supabase/functions/admin-users/index.ts` calls `admin_user_target` (line 65) and `admin_record_user_action` (line 72) with the caller's own token.
- Only after that does it use the service-role client for `auth.admin.generateLink` (line 82) and `updateUserById` (line 93).
- Guards in `_shared/admin-users.ts`:
  - Lines 247-250: suspending yourself or another admin returns `cannot_suspend_admin`; a hand-over link for a user with no email returns `no_email`.
  - Line 232: a hand-over link is only made for an allowed origin.
- Audit action names are mapped at lines 182-188. If the audit write fails, the response says `recorded:false` (lines 273-278).

## 4. Background jobs and caches

| Dependency | Schedule / mechanism | Pages that depend on it | If it stops |
|---|---|---|---|
| `channel-compare-drain` cron calling `drain_channel_compare(15)` | every 10 min (`20261021…:370-374`); fed by `channel_compare_dirty` triggers on sentiment/topic predictions (insert and update) and comment/topic reviews (insert only) (`:219-247`) | Comparison page; digest "movers" (`20261022…:39-58`) | Counts freeze. The page shows only the newest `refreshed_at` across all channels (`AdminComparePage.tsx:97-101`), so one stale workspace is hidden. If it never ran, every row shows "small sample". |
| `channel-compare-nightly` calling `mark_all_channel_compare()` | 02:47 UTC (`:375-379`) | Comparison page | Comment deletions and active-analysis changes are never recounted, and nothing on the page says so. |
| `admin-daily-digest` calling `record_admin_digest()`, stored in `private.admin_digests` | 03:53 UTC (`20261022…:160-164`); the migration records a first snapshot at deploy (`:145`) | Home morning summary | The card keeps showing the deploy-day snapshot in its "first" form; newly-failing and recovered lists never appear. |
| `private.video_comment_stats` | row-level triggers (`20261003120000…:244-270`) plus `reconcile-video-comment-stats` cron at 02:37 UTC (`20261004010000…:162`) | Home funnel, Channels console counts, palette `admin_channels`, digest totals | Counts drift with no warning on any page. |
| `public.worker_seen` heartbeat (3-minute freshness rule) | written by the worker | Home worker tile, Ops worker card, Services `python_worker` | Visible: shows "stale". |
| `sentiment-tick` cron calling `schedule_all()` | hourly at :17 (`20260917110000…:25`) | Channel states (`stale` after 48h), used on Home and Channels | Visible: channels turn stale. |

**Risk of nothing showing at all:** every cron block exits with only a `NOTICE` when `pg_cron` isn't available (for example `20261021…:359-361`). The database tests run on PGlite, so none of these schedules are tested.

## 5. Actions the owner can take

| Action | Call | Audit trail |
|---|---|---|
| Set a plan | `set_workspace_plan` | `plan_set` |
| Grant a pack | `grant_pack` | `pack_granted` |
| Delete a workspace | `delete_workspace` | `workspace_deleted` |
| Save profile details | `admin_update_user_profile` | `user_profile_updated` |
| Mark / unmark test account | `admin_set_user_test` | `user_marked_test` / `user_unmarked_test` |
| Send reset email | Supabase Auth, then `admin_record_user_action` | `password_reset_sent` |
| Hand-over link, suspend, unsuspend, confirm email, change email | Edge Function `admin-users`, then `admin_record_user_action` | yes, recorded as the caller |
| Change a member's role | `update_workspace_account_role` | `workspace_account_role_updated` |
| Log in as / stop | `admin_start_impersonation` / `admin_stop_impersonation` | `impersonation_started` / `impersonation_ended` |
| Pause / resume channels | `admin_set_channels_paused` | one row per channel |
| Request collect / catalogue | `admin_request_channel_work` | one row per queued channel |
| Set auto-selection numbers | `admin_set_auto_selection` | `auto_selection_set` |
| Import channels | `admin_import_channel` | `channel_imported` |
| Toggle public channels on a plan | `set_plan_public_channels` | **none** |
| Edit plan limits | `update_plan_limits` | **none** |

All audit rows go to `public.audit_events`.

## 6. Tests

| Area | Unit tests (`apps/web/src/admin/…`) | Database tests (`supabase/tests/…`) |
|---|---|---|
| Home | `AdminHomePage.test.tsx`, `dailyDigest.test.ts`, `channelsConsole.test.ts` (state order) | `admin_console_overview`, `admin_daily_digest` |
| Workspaces | `AdminPage`, `WorkspaceRow`, `callServer`, `adminDemo` | `platform_admin`, `workspace_lifecycle`, `plan_catalogue` |
| Accounts | `AdminUsersPage`, `AccountFile`, `adminUserAction` | `admin_account_file`, `user_impersonation`, `admin_users_handler` (shared handler only, not `index.ts`) |
| Channels | `AdminChannelsPage`, `channelsConsole`, `adminTrail` | `admin_console_overview` (console, pause, bulk) |
| Comparison | `AdminComparePage`, `compareChannels` | `admin_channels_compare` |
| System, Services, Import | `AdminSystemPage`, `AdminServicesPage`, `adminRead`, `AdminImportPage`, `channelImport*`, `EditPlanLimitsDialog` | `admin_services_health*`, `admin_import_channel`, `admin_observability` (users, channels, ops, audit), `historical_import_and_plans` / `unlimited_plan…` (`update_plan_limits`) |
| Shell and palette | `AdminShell`, `AdminCommandPalette` | – |

End-to-end (`tests/e2e/admin.spec.ts`) covers only the `/admin/workspaces?demo=1` actions and impersonation from `/admin/users?demo=1`.

**Gaps:**
- No page tests for `AdminOpsPage`, `AdminAuditPage` or `AdminPlansPage`. The plans page's broken failure path has no test.
- The member-role change is mocked but never asserted (`AccountFile.test.tsx:26`).
- No end-to-end tests for Home, Channels, Comparison or System.
- `supabase/functions/admin-users/index.ts` itself is not tested.
- The cron schedules are not tested.

## 7. Strings

- I checked 462 `S.*` and `"admin…"` keys used across the admin files, `DeleteWorkspaceDialog`, `adminWords`, `impersonation` and the banners. All are present in both `ar.ts` and `en.ts`. The one hit the scan flagged, "admins", is a segment value, not a string key. `en.ts` is also typed as `Strings` (`en.ts:11`), so a missing key would fail type-checking.
- The sub-keys of `adminChannelStates` and `adminAccountActionErrors` match between the two files.
- `adminAccountActions` (`ar.ts:659-676`, same keys in English) is missing the five action names listed at the top of this report, in both files.