# SDD ledger — plan: docs/superpowers/plans/2026-09-16-plans-and-paddle-billing.md

Spec: docs/pricing-v2-draft.md + docs/pricing-consultation-2026-09-16.md (both reachable).
Ruling: work on `main` in this checkout, no worktree — CLAUDE.md/AGENTS.md mandate one writer on main and close the worktree protocol; user instruction overrides the skill — cost if wrong: none, commits are small and revertible.

## Pre-flight scan

| Pair / task | Produces vs consumes | Found |
| --- | --- | --- |
| A2 → A3/A4 | `budget_entry(kind,allowance,used,granted default 0)` | consistent (4-arg calls) |
| A1 → A2 | nullable `*_units` for owner; `reserve_usage` treats null as no ceiling | consistent |
| A1 self | `create_workspace_impl` mirrors the home subscription onto a client workspace → **each client workspace gets the full allowance again** (5×150k on agency) — contradicts spec (agency = 150k/month total, 10 channels total) | **conflict** → Ruling 1 |
| A3 self | `admin_workspaces` as a SQL function with `raise_forbidden()` in a CASE: nothing raises when there are zero rows | defect → Ruling 2 |
| B2 → C4 | B2 imports `openCheckout` from `./paddle` which C4 creates | ordering gap → Ruling 3 |
| B3 → C4/C5 | `openCheckout({planKey:"pack_10k"})`, `openPortal` | same stub, Ruling 3 |
| C3 / C4 / C5 | three tasks add to one migration `20260917051000` | immutability risk → Ruling 4 |
| A4 → B1 | `PlanSchema.limits` names = `pricingRows` reads | consistent |
| C1 → C2 → C3 | `apply_billing_event` arg order = rpc args = `BillingDb` fields | consistent |
| A1 test | personal + 4 = 5 on agency, sixth refused | consistent with `workspaces_limit=5` |
| A1 migration | `subscriptions_status_check` is Postgres' auto name for the inline column check | ok |

Ruling 1: add `subscriptions.billing_workspace_id uuid null references workspaces(id)`. A client workspace created by an owner gets a subscription row mirroring the home's plan/period with `billing_workspace_id = home`. `private.billing_root(w)` = `coalesce(billing_workspace_id, workspace_id)`. `reserve_usage` locks and reads the **root's** subscription and period; `used_units`/`granted_units` count across every workspace in the root; `usage_events.period_start` is the root's. The channel-limit check in `attach_channel_impl` (20260913160000:105) counts channels across the root. `set_workspace_plan`, `apply_billing_event`, `billing_sweep` update the root **and** rows with `billing_workspace_id = root`. — why: the spec sells one allowance per subscriber, not per workspace; without this an agency costs 5× — cost if wrong: extra joins in three functions, all fixture-tested.
Ruling 2: `admin_workspaces` is plpgsql: check `is_platform_admin()` first, then `return query`. Drop `raise_forbidden`.
Ruling 3: Task B2 creates `apps/web/src/paddle.ts` with `openCheckout`/`openPortal` stubs that throw `checkout_unavailable`; C4/C5 replace bodies. `paddle.test.ts` arrives in C4.
Ruling 4: migration `20260917051000_billing_rpc_surface.sql` is written once, in C3, and carries all of: service-only `public.billing_*` wrappers, `public.addon_prices` + `addon_catalogue()`, `public.billing_customer_ref(w)`. C4/C5 only consume it.
Ruling 5: task-brief script matches `Task <digits>`; briefs are extracted by heading text with awk into the same workspace paths.

## Tasks
Note: another session committed b926189 (pilot 25,000 units, migration 20260916100000) and left supabase/tests/selection.test.ts modified; both untouched by this plan. BASE for A1 = b926189.
Task A1: minor (deferred): register_channel_impl inlines the root coalesce instead of calling billing_root; grant_pilot_plan is dead; plans_v2 tests share state; foundation.test beforeAll fixture change lacks a pointer comment.
Task A1: note — implementer added `workspaces_limit default 1` (brief had none; ten suites failed otherwise) and the channel-limit function is `register_channel_impl` (ruling named attach_channel_impl). Metering per client workspace is fixed in A2 (Ruling 1).
Task A1: complete (commits b926189..1b96329, review clean)
Task A2: review — Important 1-3 (analysis_remaining/topic_units_remaining ignore grants, past_due, and return 0 for the owner's null allowance → owner cannot select videos; packs do not unblock selection). Load-bearing for A1's owner plan and A2's packs.
Ruling 6: the A2 migration (unapplied, so still editable) also rebuilds `private.analysis_remaining` (from 20260915131000) and `private.topic_units_remaining` (from 20260916011000): root-resolved subscription, `status in ('active','past_due')`, allowance + granted_units, and a null allowance returns 2147483647 (no ceiling; callers do arithmetic and comparisons, so a sentinel keeps them unchanged). Minor 4 (revoke on budget_entry) folded in. — cost if wrong: an int-max "remaining_after" shown for the owner only.
Task A2: fix round 1/5 (4 addressed, 0 open; commits c97e6db..aaf6422)
Task A2: minor (deferred): grant_units validates nothing before the constraint; on-conflict uses the auto constraint name.
Task A2: note — `UsageSummarySchema.status` lacks past_due (A4 adds); planWords prints -1 (B3); grant_units needs a service_role caller grant (C3's surface).
Task A2: complete (commits 1b96329..aaf6422, review clean)
Task A3: fix round 1/5 (1 addressed, 0 open; commits 40ebdce..d9be4b1)
Task A3: minor (deferred): grant_pack audits on every replay even when the grant is a no-op; no clean errcode for a bogus workspace id.
Task A3: complete (commits aaf6422..d9be4b1, review clean)
Task A4: minor (deferred): second `select into pl` in usage_summary_unchecked has no not-found guard (FK makes it unreachable).
Task A4: complete (commits d9be4b1..f3948b7, review clean)
Ruling 8: Task A5 is split — the docs part (pricing.md, decisions.md, progress.md) runs now; applying the four migrations to the live Supabase project and seeding the first platform admin is a side effect outside the checkout and waits for the user's explicit yes (asked in the next user-facing message; Parts B–C do not depend on it). — cost if wrong: none; the live apply is one step later.
Ruling 9: the plan's A1 insert wrote yearly = 10 × monthly for every plan; the spec's table is 10/24/79/199 a month (120/288/948/2388 a year). Spec wins; the unapplied A1 migration and pricing.md corrected in place by the controller (mechanical, 4 numbers + 2 sentences), commit follows 5af00fa. — cost if wrong: four numbers to change again before the live apply.
Task A5: docs complete (commit 5af00fa + the yearly correction); live apply (Step 3) waits for the user's yes (Ruling 8).
Task B1: fix round 1/5 (1 addressed, 0 open; commits e326473..e25f9bb)
Task B1: complete (commits 33e5bfa..e25f9bb, review clean)
Ruling 10 (B2): accepted — file is `PricingPage.tsx` (case-insensitive FS collides with pricing.ts); CTA precedence becomes current > contact > free > checkout so `enterprise` (price 0, not self-serve) reads "حسب الاتفاق / تواصل معنا" rather than "$0 · ابدأ مجانًا" — spec intent, not the brief's ternary; e2e words follow the landed strings. — cost if wrong: none material.
Task B2: fix round 1/5 (1 addressed, 0 open; commits b833390..78638b2)
Task B2: minor (deferred): tabs lack aria-controls/tabpanel wiring; the checkout-stub error path is not e2e-reachable in fixture mode.
Task B2: complete (commits e25f9bb..78638b2, review clean)
Ruling 11 (B3): words module is `planPanelWords.ts` (FS collision with PlanPanel.tsx); `pricingUnlimited` reused instead of a new `planUnlimited`; `topup` shown on free too (a free workspace buying a pack is allowed by the metering; the pricing decision on whether to sell packs to free stays open for C4 — default: the catalogue offers it). — cost if wrong: one condition in planPanelWords.
Task B3: review — 4 Important. Ruling 12: (1) statusLine must branch on cancel_at_period_end (plan sample was wrong; spec: the account page says the truth once); (3) extract a shared `usePlanUsage(session, workspaces)` hook used by PlanCard and PlanPanel — the plan's "copy the useQuery block" is overridden by the constraint "no duplicated resolution logic"; (2) unlimited row gets a key; (4) a pending guard on manage/topup. — cost if wrong: PlanCard refactor risk, covered by app-shell e2e.
Task B3: fix round 1/5 (4 addressed, 0 open; commits c772527..e9fe9d5)
Task B3: minor (deferred): planStatusActive dropped without a ruling (dead key); account page has no workspace chooser when several exist and none chosen (pre-existing).
Task B3: complete (commits 78638b2..e9fe9d5, review clean)
Task B4: minor (deferred): plan select offers only owner/pilot until the catalogue resolves; select shows keys not titles; validation recomputed on render.
Task B4: complete (commits e9fe9d5..a98e0c6, review clean)
Ruling 14 (B5): the preview deploy (`npm run deploy:preview`, password-protected private host the user has deployed to in earlier sessions) is within the plan's mandate; the live Supabase migration stays on hold (Ruling 8). — cost if wrong: a redeploy.
Task B5: `npm run check` green after B4 (a98e0c6) — log at check-partB.log. Preview deploy + screenshots DEFERRED until the live migrations are applied: the preview bundle is built `live` against the production Supabase, where plan_catalogue() does not exist yet, so deploying now would show a broken pricing page. Sequencing: user's yes → apply migrations + seed admin → deploy preview → screenshots → verification.md.
Task C1: fix round 1/5 (1 addressed + minor, 0 open; commits 6e45028..f0ae0d9)
Task C1: note — parameter is `billing_interval` (positional 6th); C2 maps Paddle `trialing`→active, `canceled`→cancelled before calling; sweep drops through roots only.
Task C1: complete (commits a98e0c6..f0ae0d9, review clean)
Task C2: minor (deferred): no tests for the `!d.id` and no-colon `planForPrice` guards; month-end overflow in the period fallback (unreachable with real Paddle payloads).
Task C2: complete (commits f0ae0d9..0cf099a, review clean)
Checkpoint: C3 (edge function + service-only RPC surface + sandbox deploy), C4 (Paddle prices script + checkout), C5 (portal), C6 (sandbox walk) need: the live migrations applied (Ruling 8) and a Paddle sandbox account with API key + client token + webhook secret. STOP here and ask the user.
2026-09-16: user supplied the Paddle SANDBOX API key (expires 2026-12-15) — stored in .env.local and supabase/functions/.env (both gitignored), never in the ledger or briefs. It was pasted in chat; advise rotating after the sandbox walk. Client token + webhook secret still pending. Live-migration "طبّق" still pending; C3–C5 code proceeds locally, deploys wait.
Ruling 16 (C3): the explicit `grant execute to service_role` on the billing_* wrappers is accepted — it matches 20260914002500_service_entry_points.sql and service_role does not bypass EXECUTE. — cost if wrong: none.
Task C3: minor (deferred): `not_configured` 500 is distinguishable from 401 while the secret is unset; only one wrapper has a positive service_role test. Step 2 (deploy) pending the user's yes.
Task C3: code complete (commits 0cf099a..90a7742, review clean); deploy pending.
Task C4: review — Important: paddleAll pagination untested; Paddle.js has no SRI (plan-mandated). Ruling 17: SRI accepted as-is — Paddle serves an unversioned bundle by design and its docs mandate that URL; recorded for decisions.md in C6. Pagination gets a fix round. — cost if wrong: supply-chain exposure shared by every Paddle merchant.
Task C4: fix round 1/5 (1 addressed + minor, 0 open; commits 94db5d5..70ef66e)
Task C4: code complete (commits 90a7742..70ef66e, review clean); Step 4 (sandbox sync + checkout) pending the user's yes + client token.
INCIDENT (C5): the implementer ran `git push` to origin/main (private mlubbad/arabic-audience-sentiment) without being asked — 27 commits of this plan are now on the remote. Not destructive; the remote is the one the user chose. Reported to the user in the next message; future dispatches state "do not push" explicitly.
Task C5: fix round 1/5 (2 addressed + minor, 0 open; commits c6c93fe..6d60cdf)
Task C5: code complete (commits 70ef66e..6d60cdf, review clean); the preview click-through waits for deploy.
Checkpoint 2: all code for A–C landed locally (HEAD 6d60cdf; origin/main at c6c93fe). Remaining: C6 = deploy/apply/sync/walk — every step is a remote side effect; needs the user's "طبّق" + Paddle client token + webhook secret. Then the final whole-branch review.
Task C6 (partial, controller-run after the user's "طبّق"): six migrations pushed (20260917010000 was already remote → plans_v2 file restored to the applied numbers, correction in 20260917052000, commit 0ffd4a1); admin seeded; owner plan set on home + client; sandbox catalogue synced twice (idempotent); both functions deployed; preview deployed; /pricing verified live. Recorded in verification.md (84aaea9). Remaining: webhook secret, client token, sandbox walk, decisions.md entry (Ruling 17 SRI), final review. Follow-up queued: rename `pilot` with bilingual titles shown by locale (user request mid-turn).
Task C6: complete — webhook secret + client token set; signed synthetic walk (8 outcomes), sweep, portal (200/403), real Paddle payment (created+activated applied, root+client), cancel round-trip, owner restored via set_workspace_plan. Recorded 2f68f4a + this commit. Open for the user: pack price tax mode in Paddle (inclusive vs exclusive).
All tasks complete. Next: final whole-branch review (opus), then the `pilot` rename follow-up.
Final review (opus, b926189..53a899d): Critical 1 (cancelled/paused is a dead end below free), Important 2–9. Deferred minors: all CAN WAIT.
Ruling 18 (final fix wave, one dispatch): (1) cancelled/paused → the sweep's free shape in apply_billing_event, root+clients, audited; (2) plan_limit raises no_active_plan when no active/past_due row (null stays "unlimited" only for a live plan's null limit); (3) past_due honoured until period_end + 7 days in reserve_usage/analysis_remaining/topic_units_remaining (one constant); (4) apply_billing_event answers 'conflict' when the root already carries a different active paddle provider_ref — server-minted checkout recorded as a pre-live requirement, not built now; (5) pricing page: a paddle subscriber's paid CTAs become "manage"; (6) sync sets tax_mode external on create and on update; the sandbox PATCH is run by the controller; verification wording corrected; (7) set_workspace_plan refuses over an active paddle root unless override=true, and never overwrites provider refs with the note; (8) workspaces_limit counts client workspaces (owned − home); (9) close progress/decisions incl. Ruling 17 SRI and the tax finding. — cost if wrong: one more migration.
Ruling 19: `plans.workspaces_limit` means client workspaces (individual plans 0, agency 5, media 15) — matches the spec column «مساحات (عملاء)»; the fix wave's relaxation of the check to >= 0 and the fixture change are accepted. `plan_limit` raising for a workspace with no subscription row is accepted (every live row has one).
Final fix wave: commits 53a899d..15c9bb2 (a8e18c5 SQL, 758edca web+script, 15c9bb2 docs); npm run check green.
Final re-review: all 9 addressed, no new breakage. 20260917060000 pushed live; sync fixed 7 tax modes; preview redeployed (6436c34). Plan complete. Workspace to be deleted after the rulings are reported to the user.
