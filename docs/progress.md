# Progress

Updated 2026-09-13. Status words are used strictly:
**implemented** = code exists and its tests pass; **fixture-tested** = verified only against
sanitized synthetic data; **blocked** = cannot proceed without a named missing input.

**Nothing here has run against live YouTube, Google OAuth, a deployed Supabase project, a
real sentiment model, or any deployment.** Every "implemented" below means verified in
embedded PostgreSQL, in Node, or in a browser against fixtures. The list of what that
excludes is at the end of `verification.md` and is the honest limit of this work.

## M0 — scaffold and reproducibility (complete)

Monorepo, pinned manifests and both lockfiles, placeholder-only `.env.example`, documented
commands, CI restricted to credential-free checks, clean install verified from lockfiles.
CI has never executed: there is no remote.

## M1 — collection primitives (unblocked parts implemented)

| Item | Status | Notes |
| --- | --- | --- |
| Collector protocol | implemented | "Exhausted" means the source stopped returning rows, never that everything was retrieved |
| YouTube Data API adapter | fixture-tested | Explicit reply pagination, tested against synthetic HTTP only. **Never run against live YouTube** |
| Durable local spool | implemented | Lease fencing, heartbeats, bounded retries, rows and checkpoint in one transaction |
| Queue semantics | implemented | Lease bounds, batch limits, exponential backoff, both routes to a terminal job |
| Failure is never success | implemented | 403/429 → blocked, 5xx → retryable failure, malformed JSON → invalid response |
| Sentiment interfaces | implemented | Pinned-revision registry, preprocessing, a deterministic test analyzer that is **not a model** |
| Catalogue import, live discovery, model inference | **blocked** | Needs the ZIP, the CSVs, an API key, the notebooks |

## M2 — secure SaaS foundation (complete)

Composite tenant keys, RLS resolved from `auth.uid()` through a non-exposed helper, lease
tokens withheld from the tenant projection, role-checked RPCs, personal workspace bootstrap,
private storage scoped by workspace UUID, append-only review log, usage metering with
reservation, plan limits. Isolation is tested through direct SQL, not hidden UI controls.

## M3 — ingestion and analysis (server path complete)

| Item | Status | Notes |
| --- | --- | --- |
| Worker batch contract (I1) | implemented | Rows addressed by platform id; **no workspace field exists** in the payload |
| Atomic ingestion (P2) | implemented | Rows, predictions, checkpoint and meter in one transaction; a batch that cannot be paid for in full is refused whole |
| Replay safety | implemented | `batch_key` plus payload fingerprint: identical replay is a no-op, a reused key with different rows is a conflict |
| Metering | implemented | One unit per unique comment, ever. Retries, reimports, likes refreshes and re-analysis after an edit are free |
| Worker gateway (P3) | implemented | Scoped credential, never the service role; the tenant comes from the credential |
| Worker lifecycle | implemented | Explicit terminal result; nothing promotes a job to succeeded on its own |
| Python control-plane client | implemented | Canonical payload hashing; only an exhausted source maps to succeeded |
| Edge handler | implemented, **not deployed** | Pure handler with an injected data layer. **Has never served a real request** |
| Legacy import and reconciliation | **blocked** | Needs the original CSVs and the amendment file |
| Analysis in the server path | implemented, fixture-tested | `run_once` labels each batch before committing, so rows and verdicts land in one transaction. Verified end to end with the **deterministic test analyzer, which is not a model** |
| Real model inference | **blocked** | Needs the notebooks and ~600 human-labelled comments. No accuracy figure is claimed |

## M4 — dashboard (complete, fixture-backed)

One filter contract drives every panel and the export. Cursor pagination with stale-response
safety, human corrections with verdict history, CSV export with formula-injection
neutralisation, plan limits with early warning, video comparison on per-video denominators,
sync health classified into ten states, engagement ranking that never lets likes weight
sentiment. Arabic RTL throughout, keyboard-navigable, no figure carried by colour alone.

Fixture mode is isolated from configured Auth: a correction made against fixture rows can
never be sent to a live RPC, and the UI says so on screen.

## M5 — OAuth (server half implemented)

| Item | Status | Notes |
| --- | --- | --- |
| State lifecycle | implemented | Hash-only storage, bound to user/workspace/client, 10 minutes, single use. Spent states are prunable; no schedule until there is a project to attach one to |
| Callback cannot be redirected | implemented | Consume returns the binding rather than accepting one; there is no workspace argument to forge |
| Channel ownership | implemented | Connected claim is globally exclusive; a public_unverified row is upgraded in place so pilot data carries over |
| Revocation | implemented | Moves to reconnect_required and cancels dependent jobs; never falls back to scraping |
| Authorization URL, code exchange, PKCE, channels.list, redirect page | **blocked** | Needs Google credentials |

## M6 — private pilot (not started)

Needs a Supabase project and Sites access. Nothing is deployed.

## Exact missing input per blocked task

| Blocked task | Exact input required |
| --- | --- |
| Legacy import and the handoff's topic-count reconciliation | Original comments CSV/data files, plus the classification amendment file |
| Catalogue verification (35 + 157 + 2 = 194) | `SpecTech-YouTube-MVP-Package.zip` with its manifest and JSONL catalog |
| Final dashboard styling | Standalone dashboard HTML, the dashboard ZIP, and the brand assets |
| Live public collection | A YouTube Data API key placed server-side |
| Live Auth, Storage, Edge Functions, and proving the edge handler and SQL agree over HTTP | Supabase development project URL and keys |
| OAuth exchange and live connection | Google OAuth client id/secret, registered redirect URI, test-user authorization |
| Model selection and any accuracy claim | The two model notebooks and ~600 independently human-labelled comments |
| Private pilot deployment | Sites access with a verified private mode |

## Known limitations

- Database evidence is PGlite. It runs the real SQL and real RLS but **is not** GoTrue,
  PostgREST, Storage HTTP, or a deployed project.
- Concurrent overspend is not provable here: PGlite runs a single connection, so two
  simultaneous transactions cannot be staged. The row lock is the mechanism; what the tests
  prove is that no *sequence* of calls exceeds an allowance.
- The edge handler and the SQL now meet in `end_to_end.test.ts`, over a request body captured
  from the real Python client. What remains untested is an actual network hop and a deployed
  Edge Function runtime.
- The handler does not validate the body against the shared contract. The shapes now match, so
  this is a deployment question — the contracts package imports Zod and the function has no
  import map — not a correctness gap: every rule the contract states is enforced in SQL.
- Video titles are absent from the contract, so the comparison labels by identifier.
- The dashboard is a neutral functional shell. Final styling waits on the original assets.

## Coordination

Four lanes with an ownership guard and a pre-commit hook: worker, platform, schema,
integration. The guard is not decorative — it refused three commits during this work and each
time the change belonged in another lane.

The worker and schema lanes have no commits. Work assigned to them was taken on directly
after the user reassigned it; where it crossed a lane, it was committed on integration so
those lanes can rejoin by merging rather than by reconciling a rewritten branch.
