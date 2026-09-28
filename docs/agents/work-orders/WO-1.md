# #9 WO-1: gate deploy on CI, remove hard-coded secrets, turn main green

Mirror of GitHub issue #9. **The issue is the source of truth**; this copy exists for agents whose token cannot read issues. If they differ, ask.

```text
Branch codex/wo-1-deploy-gate · PR "WO-1: gate deploy on CI, remove hard-coded secrets"
Depends on #8 (WO-0, the owner's job) for step 5 only.

WHY
- deploy.yml runs in parallel with CI. It only runs check:secrets + typecheck + build, then uploads to the live site and runs production migrations. The last 3 pushes had red CI and all deployed.
- CI on main is red for two reasons:
  - tests/e2e/admin.spec.ts:194 writes a screenshot to a Mac-only path (/Users/muhammed/.gemini/antigravity/...).
  - .gitleaksignore pins commit SHAs that no longer exist after the history reset.
- Two real credentials are hard-coded:
  - workers/python/tests/test_brightdata_scraper.py (~237-238)
  - scripts/run_telegram_collect.py:42
  Neither gitleaks nor scripts/check-secrets.mjs caught the Bright Data one.

OWNED PATHS
- .github/**
- .gitleaksignore
- scripts/check-secrets.mjs, scripts/run_telegram_collect.py, scripts/deploy-preview.sh, scripts/apply-migrations-remote.mjs
- a new scripts/check-secrets.test.mjs
- tests/e2e/admin.spec.ts
- workers/python/tests/test_brightdata_scraper.py: ONLY test_check_brightdata_diagnostics (Gemini owns the rest of workers/python)

TASKS
1. Remove the hard-coded default for WORKER_CREDENTIAL in scripts/run_telegram_collect.py. If it's unset, exit non-zero with a clear message. Scan tracked files for other hard-coded fallbacks of this kind.
2. In test_check_brightdata_diagnostics, replace the real values with obvious fakes. Mock httpx (monkeypatch httpx.post/get or MockTransport) so there are ZERO network calls. Cover three cases: healthy, API auth failure, and webdriver not ready. It must pass with the network disabled.
3. scripts/check-secrets.mjs:
   - Add a rule for credentials embedded in URLs (scheme://user:password@host). Ignore placeholders: user:pass@, USER:PASSWORD@, <...>.
   - Add a unit test that catches a synthetic value shaped like the Bright Data URL and ignores the placeholders. Never include the real value.
4. tests/e2e/admin.spec.ts: remove the absolute screenshot path (use testInfo.outputPath(...) or drop the screenshot). Run `git grep -n "/Users/"` and list any other hits outside your paths in the PR.
5. .gitleaksignore:
   - Refresh the current fingerprints for the synthetic fixtures (workers/python/tests/fixtures/golden_batch.json, supabase/tests/worker_gateway_handler.test.ts). Keep the comment style.
   - For the scripts/run_telegram_collect.py finding: WAIT until Mohammed confirms rotation (WO-0 "history choice A"). Then add its exact fingerprint with a comment "real credential, revoked on <date>".
   - Never add a path-wide exclusion.
6. .github/workflows/deploy.yml:
   - Deploy only when "verify" (workflow "Credential-free checks") AND every job of workflow "Security" (Secret scan, Semgrep SAST, Dependency audit) succeeded for the SAME commit SHA on a push to main. One option: workflow_run plus an API check of the other workflow's conclusion for head_sha. Choose and explain.
   - codeql.yml runs only on pull_request/workflow_dispatch; CodeQL is enforced at PR time by branch protection, so don't wait for it.
   - Check out exactly that SHA.
   - Never run for pull_request or for non-main branches. workflow_dispatch only when github.ref == refs/heads/main.
   - environment: production.
   - cancel-in-progress: false.
   - Migrations BEFORE the frontend upload.
   - A missing required secret FAILS the run (no notice-and-skip).
   - AGENTS.md rules still apply: SHA-pinned uses with a version comment (resolve SHAs from the registry, not memory), least-privilege permissions, timeout-minutes, persist-credentials: false, no pull_request_target.
7. (Best effort) scripts/deploy-preview.sh: require TLS on the data channel (--ssl-reqd), and keep the password out of curl argv (temporary --netrc-file, mode 600, deleted on exit). You can't test against the host, so say so in the PR.
8. scripts/apply-migrations-remote.mjs:
   - Remove the silent fallback to the production project ref; require it explicitly.
   - Refuse a file containing a bare `commit;` or `CONCURRENTLY`.

ACCEPTANCE
- [ ] npm run check and npm run test:e2e pass locally (paste the summary lines).
- [ ] npm run worker:test passes with the network disabled (say how you checked).
- [ ] PR CI: verify green. Secret scan may stay red ONLY for the Telegram-script fingerprint until WO-0 is done; say so in the PR.
- [ ] actionlint (or equivalent YAML validation) and `semgrep scan --metrics=off` are clean on the changed workflows (paste the output).
- [ ] The PR explains the gate design and why a red verify or red Security job on a SHA now prevents deploy.
- [ ] No real secret values anywhere.
- [ ] Each new test fails on the old code (say how you proved it).

OUT OF SCOPE
Rotation (the owner does it), supabase/, apps/web/, workers/python/src/, docs/progress.md, docs/verification.md.
```
