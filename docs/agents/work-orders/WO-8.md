# WO-8 (Codex): remove the one-time OAuth ticket from the /connected URL

Mirror of GitHub issue #54. **The issue is the source of truth**; this copy exists for agents
whose token can't read issues. If they differ, ask.

- **Branch:** `codex/wo-8-strip-oauth-ticket`
- **PR title:** `WO-8: remove the OAuth ticket from the URL` (body starts `Closes #54` and fills
  the PR template: evidence, mutation proof, scope)
- **Frontend only.** No migration, no edge-function change, no deploy.
- Line numbers are from `main` at `89d160c`.

## Why
After WO-5b (#16/#48), Google's callback sends the person to
`/connected?connect=pending&ticket=<ticket>`. `apps/web/src/Connected.tsx:16-22` reads `ticket`
and passes it to `completePendingConnection`, but never removes it from the address bar, so it
stays in browser history, in copied links and in screenshots.

The risk is low. The ticket is single-use (`oauth_complete_impl` consumes it before checking)
and bound to the browser nonce in `sessionStorage`, and the only external link on the page uses
`rel="noreferrer"`. Still, a credential-shaped value should not persist after it is used.

## Fix (small)
- In `Connected.tsx`, once the ticket has been captured for completion, replace the current
  history entry with a URL that has **no `ticket` parameter** and **keeps `connect=pending`**.
  `connectResult(params, …)` keys the page off `connect=pending`, so the rendered result must not
  change. Use react-router's `setSearchParams(next, { replace: true })` or
  `history.replaceState`; replace, never push.
- Completion must still run **exactly once**. The existing `started` ref latch must keep working
  when `params` changes after the strip, including under React StrictMode's double effect.
- No change to `connectResult.ts`, `connect.ts`, the edge functions or SQL.

## Owned paths
- `apps/web/src/Connected.tsx`
- `apps/web/src/Connected.test.tsx`

**Do not touch:** `apps/web/src/account/**`, `session.ts`, `data.ts`, `impersonation.tsx`,
`dashboard/**` (Gemini's open PR #53), any migration or `supabase/functions/**`.

## Acceptance criteria
- [ ] A unit test renders `/connected?connect=pending&ticket=abc`. It asserts that
      `completePendingConnection` is called **once** with `"abc"`, and that afterwards the
      location has no `ticket` but still has `connect=pending`. Show it failing on `89d160c` and
      passing on the branch.
- [ ] A unit test shows the success and error results render the same as before the strip (same
      heading and tone for a mocked success and a mocked `oauth_binding_mismatch`).
- [ ] The history entry is replaced, not pushed. Assert it in the test (for example, the history
      length is unchanged, or a `replace` spy is called).
- [ ] `npm run check` and `npm run test:e2e` pass. Paste the summary lines.
- [ ] No deploy, no remote migration, never push to `main`.
