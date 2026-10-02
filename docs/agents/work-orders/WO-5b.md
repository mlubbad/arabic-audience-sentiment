# WO-5b (Codex): bind the YouTube OAuth flow to the browser and user that started it

Mirror of GitHub issue #16. **The issue is the source of truth**; this copy exists for agents
whose token can't read issues. If they differ, ask.

- **Start:** now. WO-2 (#10) is merged. The original "after WO-4 (#12)" precondition is **waived by
  the owner** (2026-10-02): WO-4 is not in flight, and none of its tasks touch `connect.ts`,
  `connectResult.ts` or `Connected.tsx`. The only shared files are `apps/web/src/strings/{ar,en}.ts`:
  **append new keys only**, never reorder, rename or rewrite existing ones, so WO-4 can merge cleanly later.
- **Branch:** `codex/wo-5b-oauth-binding`
- **PR title:** `WO-5b: bind OAuth completion to the initiating browser`
- **Migration timestamp range:** `20261002000000`–`20261002235959`

## Why
State and PKCE are bound to the *initiating user* in the database, but nothing ties the
*completion* to that user's browser:
1. The attacker (owner of workspace A) calls `oauth-start` and sends the Google URL to a victim.
2. The victim consents on Google's genuine screen.
3. `oauth-callback` attaches the victim's channel (`youtube.force-ssl` grant) to workspace A.

## Where the current code is (read only these)
- **Client:** `apps/web/src/connect.ts:40-70` POSTs to `oauth-start` and navigates to the returned
  `url`. `apps/web/src/connectResult.ts` reads the result when the browser comes back.
- **Start:** `supabase/functions/_shared/oauth-start.ts:80-124` (`beginAuthorization`); entry
  `supabase/functions/oauth-start/index.ts`.
- **Callback:** `supabase/functions/_shared/oauth-callback.ts:233-290` (`handleCallback`: consumeState
  → exchangeCode → fetchOwnChannel → attachChannel); entry `supabase/functions/oauth-callback/index.ts`.
- **SQL:** `private.oauth_states` (`20260912185902_foundation.sql:119`); `private.oauth_consume_state`
  (`20260913150000_oauth_connection.sql:40`); `private.oauth_attach_channel_for` (last definition
  `20260915132000_worker_catalogue_and_due_lists.sql:242`).
- **Tests:** `supabase/tests/oauth_start.test.ts`, `oauth_callback.test.ts`, `oauth.test.ts`;
  `apps/web/src/connect.test.ts`, `connectResult.test.ts`.

## Design (decided)
1. **Start:** also create a random `browser_nonce` (32 bytes, base64url). Store `sha256(nonce)` with
   the state (new nullable column) and return `{ url, nonce }`. The client keeps the nonce in
   `sessionStorage`, then navigates.
2. **Callback:** after consumeState + exchangeCode + fetchOwnChannel, do **not** attach. Store a
   pending connection in a new `private.oauth_pending` table (RLS on, no anon/authenticated grants)
   holding: state row id, sealed tokens (`sealTokens`), channel metadata, `ticket_hash`, and
   `expires_at` 10 minutes out. Redirect to `APP_ORIGIN/…?connect=pending&ticket=<random>`: only
   the ticket, never tokens.
3. **Complete:** new edge function `oauth-complete` (`verify_jwt = true` in `supabase/config.toml`)
   takes `{ ticket, nonce }` plus the user's JWT. In one SQL call, check:
   - the ticket is valid and not expired;
   - `sha256(nonce)` matches;
   - `auth.uid()` is the state's `user_id`;
   - the user still holds the required role in that workspace.
   Then attach, single use. Any mismatch is refused with `oauth_binding_mismatch`, and the pending
   row is deleted either way.
4. **Client:** the `connect=pending` completion is a side effect, so it must **not** run inside the
   pure `connectResult()` (it is called during render in `Connected.tsx`; a fetch there would be a
   render-time side effect that React 19 Strict Mode double-invokes → the ticket is consumed twice).
   Do the completion in a `useEffect` in `Connected.tsx`, guarded by a `useRef` latch so Strict
   Mode's double-invoke fires it once: read the nonce, call `oauth-complete`, clear the nonce, hold
   the resolved outcome in state. Keep `connectResult()` a pure mapper and extend it to render the
   in-flight ("finishing…") and completed success/error states from that resolved outcome. The real
   single-use guarantee is server-side (step 3, single-use ticket / replay refused) — the ref latch
   is defense-in-depth, not the guard. New strings go in both `strings/ar.ts` and `strings/en.ts`.
5. **Pruning:** expired pending rows are pruned by the existing `prune-oauth-states` job.

## Owned paths
- New migrations in the range above.
- `_shared/oauth-start.ts`, `_shared/oauth-callback.ts`, `oauth-start/**`, `oauth-callback/**`,
  and a new `oauth-complete/**`.
- The new function's block in `supabase/config.toml`.
- `supabase/tests/oauth*.test.ts`.
- `apps/web/src/connect.ts`, `connectResult.ts`, and `Connected.tsx` plus their tests.
  (`Connected.tsx` was added to this WO on 2026-09-29 to allow the effect-based completion in
  step 4 — see the ruling on issue #16.)
- New string keys only.

## Acceptance criteria
- [ ] **Attack test:** user A starts, the callback completes, then `oauth-complete` is called with
      user B's JWT → refused, and nothing is attached.
- [ ] A wrong or missing nonce is refused; an expired or reused ticket is refused.
- [ ] Happy path: the channel is attached exactly once, and a replayed ticket is refused.
- [ ] The callback's redirect URL contains only the ticket.
- [ ] New table: private schema, RLS on, no anon/authenticated grants. New `SECURITY DEFINER`
      functions set `search_path=''` and `revoke … from public, anon`.
- [ ] Each new test fails on the old code (say how).
- [ ] `npm run check`, `npm run check:functions` and `npm run test:e2e` pass (paste the summary lines).
- [ ] No deploy. Write the exact deploy order for the owner in the PR.
