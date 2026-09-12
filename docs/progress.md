# Progress

Updated 2026-09-12. Status words are used strictly:
**implemented** = code exists and its tests pass; **fixture-tested** = verified only against
sanitized synthetic data; **blocked** = cannot proceed without a named missing input.
No item below has been validated against live YouTube, Google OAuth, a deployed Supabase
project, a real sentiment model, or any deployment.

## M0 — scaffold and reproducibility (complete)

| Item | Status | Evidence |
| --- | --- | --- |
| Git workspace with `.gitignore` | implemented | Branch `codex/m0-foundations`; ignores `.env*` (except the example), raw data dirs, archives, notebooks, caches, build output |
| Monorepo layout | implemented | `apps/web`, `packages/contracts`, `supabase/{migrations,functions,tests}`, `workers/python`, `docs` |
| Pinned manifests and lockfiles | implemented | `package-lock.json`, `workers/python/uv.lock`; `save-exact` and `engine-strict` in `.npmrc` |
| `.env.example`, placeholders only | implemented | Every variable from the handoff's environment contract, all empty |
| `CLAUDE.md` pointing to AGENTS.md and the handoff | implemented | Present at repository root |
| `docs/decisions.md`, `progress.md`, `verification.md` | implemented | This file plus its two siblings |
| Documented build/lint/typecheck/test/worker commands | implemented | `package.json` scripts, described in `README.md` |
| CI restricted to credential-free checks | implemented | `.github/workflows/ci.yml`; never executed here — no CI run exists yet |
| Clean install verified | implemented | `node_modules` and `.venv` deleted and rebuilt from lockfiles; see verification |

## M1 — collection primitives (unblocked parts implemented)

| Item | Status | Notes |
| --- | --- | --- |
| Collector adapter protocol | implemented | `Collector`, `Batch`, `RawComment`, six-value `Outcome`; exhaustion means source traversal ended, never "all comments exist" |
| YouTube Data API adapter | fixture-tested | Explicit reply pagination; tested against synthetic `httpx.MockTransport` responses only. **Never run against live YouTube.** |
| Durable local spool | implemented | SQLite with `BEGIN IMMEDIATE`, lease tokens, heartbeat fencing, bounded attempts, exponential backoff |
| Resume without duplication | implemented | Rows plus checkpoint commit in one transaction; a rolled-back batch leaves no rows and no checkpoint |
| Failure is never success | implemented | 403/429 → `blocked`, 5xx → retryable `failed`, malformed JSON → `invalid_response`; none become `succeeded` |
| Text-version history | implemented | `versions` table keyed by content hash; an edited comment keeps its prior version |
| Collection smoke command | fixture-tested | `npm run worker:collect`; manifest states coverage is source traversal only |
| Sentiment adapter interface | implemented | `SentimentAdapter` protocol, `Prediction` invariants, pinned-revision `ModelCard` registry, preprocessing |
| Deterministic test analyzer | implemented | Clearly named `deterministic-test-analyzer`; **not a model** and must never be shown as a prediction |
| Catalog import and legacy importer | **blocked** | Needs the source ZIP, the original comments CSV, and the classification amendment file |
| Real channel discovery | **blocked** | Needs a YouTube Data API key or an authorized `yt-dlp` run; no live call has been made |
| Model inference and benchmark | **blocked** | Needs the model notebooks and ~600 human-labelled comments. No accuracy figure is claimed |

## M2 — secure SaaS foundation (unblocked parts implemented)

| Item | Status | Notes |
| --- | --- | --- |
| Initial migration | implemented | `supabase/migrations/20260912185902_foundation.sql` |
| Composite tenant keys | implemented | `(workspace_id, id)` uniqueness and composite foreign keys; a cross-workspace child insert fails even for a privileged role |
| RLS on every exposed table | implemented | Membership resolved from `auth.uid()` through a non-exposed `private.has_role`, never from user metadata |
| Lease tokens hidden from tenants | implemented | Column-level `SELECT` grant on `jobs` omits `lease_token` |
| Privilege escalation blocked | implemented | No grant lets a member change their own role, move a row between workspaces, or set a channel to `connected` |
| Role-checked RPCs | implemented | `create_workspace`, `enqueue_sync` (idempotent by `dedupe_key`), `register_channel`, `submit_comment_review` |
| Human corrections | implemented | Verdict, reviewer and reason written only through the RPC; reviewer id and `human` provenance come from the session, so a tenant cannot forge either or claim `legacy_unverified` |
| Optimistic concurrency on text | implemented | A correction carries the hash of the text the reviewer read; if the comment changed since, the write is a conflict rather than a silent verdict on new text |
| Append-only review log | implemented | A trigger rejects UPDATE and DELETE on `comment_reviews` even for a role that bypasses RLS |
| Personal workspace bootstrap | implemented | Definer trigger on `auth.users`, so no signed-in user is left without a tenant |
| Worker job primitives | implemented | `claim_job` (`FOR UPDATE SKIP LOCKED`), `heartbeat`, `commit_checkpoint`; expired lease cannot write; repeated batch key is idempotent and a conflicting payload is rejected |
| Private storage | implemented | Non-public `imports`/`exports` buckets, paths prefixed by workspace UUID, role-gated upload |
| Server authorization helper | implemented | `authorize()` verifies identity and *current* membership separately; dependency-injected for credential-free tests |
| Arabic RTL shell | fixture-tested | Real `fetch`, genuine loading/error/retry/empty states, filters driving every panel from one snapshot |
| Cursor pagination | fixture-tested | Prev/next over a cursor stack with a page-size control; aggregates describe the filtered set, not the page; a cursor is dropped whenever filters or page size change |
| Stale-response safety | fixture-tested | Results are keyed by filter, so a late response for abandoned filters cannot repaint a newer screen — proven with a held request that was released and completed |
| Refresh vs. load states | fixture-tested | Full loading state only before there is data; afterwards the current screen stays put behind a refresh indicator |
| Invalid-cursor recovery | fixture-tested | If the row a cursor names disappears, the page is rebuilt from page one and the user is told, instead of showing an empty or mismatched page |
| Correction UI | fixture-tested | Per-row correction form; the corrected label overrides the model for the current text and every aggregate moves with it through the one shared snapshot |
| Correction persistence | **blocked** | Without a Supabase project the UI keeps corrections for the browser session only, and says so on screen. The RPC call path exists but has never reached a real server |
| Supabase Auth account screen | implemented, not live-tested | Renders an honest "not configured" state without credentials; sign-in/sign-up paths have never contacted a real Supabase project |
| Live Auth, Storage, PostgREST, Edge Function behaviour | **blocked** | Needs a Supabase development project URL and publishable key |
| OAuth (M5) | not started | Table shapes and status values exist; no flow implemented |

## Known limitations

- Database evidence comes from PGlite, which runs the real SQL and real RLS but **is not**
  GoTrue, PostgREST, Storage HTTP, or a deployed Supabase project. The test file creates
  minimal stand-in `auth`/`storage` objects. Full Supabase integration is a separate gate.
- `channels` is unique per workspace, so two tenants may currently register the same public
  channel id. This is deliberate for pre-OAuth public collection; ownership is proven at M5
  by the channel identity returned from an authorized connection, not by a claimed URL.
- The dashboard is a neutral functional shell. Final styling waits on the original dashboard
  HTML, the ZIP, and the brand assets. Nothing here reproduces the reference design.
- The legacy topic-count discrepancies in the handoff are not yet reproducible: the source
  rows are missing, so no reconciliation report exists.

## Exact missing input per blocked task

| Blocked task | Exact input required |
| --- | --- |
| Legacy import and reconciliation report | Original comments CSV/data files, plus the classification amendment file |
| Catalog verification (35 + 157 + 2 = 194) | `SpecTech-YouTube-MVP-Package.zip` with its manifest and JSONL catalog |
| Final dashboard styling | Standalone dashboard HTML, the dashboard ZIP, and the brand assets |
| Live public collection | A YouTube Data API key placed server-side (never in `VITE_*`) |
| Live Auth, Storage and Edge Functions | Supabase development project URL and publishable key, plus service-role key held server-side |
| OAuth connection | Google OAuth web client id/secret, registered redirect URI, and test-user authorization |
| Model selection and any accuracy claim | The two model notebooks and ~600 independently human-labelled comments including Mixed |

## Next unblocked work

1. Add CSV export with formula-injection neutralisation on output while the stored raw text
   stays unmodified.
2. Add `usage_events` reservation inside the batch transaction so concurrent requests cannot
   overspend a plan limit.
3. Add the remaining dashboard filters the contract already supports — comment type, reply
   mode, review status, video kind — now that one snapshot drives every panel.
4. Surface the review history per comment (who, when, why) now that the log is append-only.
