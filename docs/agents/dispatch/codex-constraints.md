## Dispatcher constraints (appended to every Codex work-order prompt)

You run inside the Codex sandbox (`workspace-write`, network on). `.git/` is read-only there
by design, and the dispatcher script outside the sandbox owns every git write. Work as follows:

1. **Edit and test only.** Make the code changes the work order asks for, run the repository's
   real commands (`npm run lint`, `npm test`, `npm run test:db`, `npm run db:snapshot:check`,
   `npm run test:e2e`, `npm run worker:test` — whichever the work order's Definition of Done
   names) and paste their real output in your final message.
2. **Do not run git writes.** No `git switch/checkout -b`, `commit`, `push`, `merge`, `rebase`,
   `reset --hard`, `stash`, `tag`. Reads are fine: `git status`, `git diff`, `git log`,
   `git fetch`, `git show`. If any command is blocked by the sandbox, say so verbatim in your
   final message and stop; **never work around it** — no `GIT_DIR`, no `--git-dir`, no
   `git init` or `git clone` anywhere, no repositories under `/tmp`, no browser automation.
3. **Hand over through `.codex-handoff/`** (already created, gitignored):
   - `.codex-handoff/commit.txt`: the full commit message (conventional-commit subject line,
     blank line, body with the commands you ran and their results).
   - `.codex-handoff/pr.md`: line 1 is the PR title exactly as the work order specifies
     (`WO-N: …`); from line 2 the PR body, starting with `Closes #N`, then the sections of
     `.github/pull_request_template.md` filled in with real output.
   The dispatcher commits with that message, pushes your branch, opens the PR and comments
   `Ready for review: PR #<n>` on the issue. You do none of that yourself.
4. **Stay inside your work order's owned paths.** Never touch `.githooks/`, `.claude/`,
   `.gitleaksignore` or `.github/workflows/**` unless the work order names them; the dispatcher
   refuses to commit otherwise. Never read credentials, tokens, keychains, `~/.ssh` or other
   tools' session files. Never deploy or run `npm run db:migrate:remote`.
5. **Finish with a short final message**: what changed (files), which suites ran with their
   counts, and anything you could not do and why.
