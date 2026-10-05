# Dispatching Codex from the owner's Mac

The PM (a Claude cloud session) sends work orders to a bridge session on the owner's Mac. That
session hands each work order to the Codex CLI with `scripts/codex-dispatch.sh` and reports back:
Codex's final message, the PR number and the branch head SHA. This page is the runbook and the
record of why the script looks the way it does.

## How it works

```
scripts/codex-dispatch.sh WO-14 76 codex/wo-14-slug ["extra instructions"]
```

| Step | Who | What |
| --- | --- | --- |
| 1 | script | Finds `codex` (PATH, else the ChatGPT.app bundle), checks `codex exec` exists, checks `gh` is installed and logged in. |
| 2 | script | Prepares `.codex-workspace/`, a dedicated clone (gitignored): fetch `origin/main`, refuse to run if it is dirty, `git switch -C <branch>` from the branch's own tip on `origin` when it exists (a follow-up round), else from `origin/main`; unset `core.hooksPath` (hooks never run there), `npm run setup` on first use. |
| 3 | script | Builds the prompt: the work order line plus `docs/agents/dispatch/codex-constraints.md`. In a follow-up round it adds the latest `## PM review` on the open PR (fetched with `gh pr view`, passed as data) and tells Codex its earlier commits are already there. |
| 4 | Codex | `codex exec -C .codex-workspace -s workspace-write` with network access. Edits, runs the suites, writes `.codex-handoff/commit.txt` and `.codex-handoff/pr.md`. **No git writes, no PR, no browser.** |
| 4 | script | `scripts/codex-watch.mjs` tails the JSON log, prints one line per event and kills Codex on the first forbidden command (exit 3). It is a tripwire, not a boundary: it matches command strings, so `g""it push` or a `python -c` subprocess passes it. |
| 5 | script | Guards: Codex changed something; it did not touch `.githooks/`, `.claude/`, `.gitleaksignore`, `.github/` (set `CODEX_ALLOW_WORKFLOWS=1` for a work order that owns workflows; the rest of `.github/` stays protected), the dispatcher, the watcher, `docs/agents/dispatch/` or the Claude-owned files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `docs/progress.md`, `docs/verification.md`, `docs/decisions.md`, `docs/adr/`); both handoff files exist; the PR title starts with `WO-N: `; the body starts with `Closes #N`. |
| 6 | script | `git -c core.hooksPath=/dev/null commit --no-verify -F`, the same for `push -u origin <branch>`, `gh pr create` (or, in a follow-up round, `gh pr edit --body` on the open PR), `gh issue comment N "Ready for review: PR #n @ sha"` (`Ready for re-review` in a follow-up round), then the report. |

Nothing is committed or pushed unless Codex exited 0 and the watcher saw nothing forbidden.

**The controls, in order of strength.** (1) The `workspace-write` sandbox. (2) The script runs
no repository code outside it: only `git` with hooks off and `gh` with fixed arguments
(`scripts/codex-dispatch.test.ts` pins this). (3) The protected-path guard. The watcher is an
early warning on top of these, never a reason to relax them.
`CODEX_DRY_RUN=1` prepares the workspace and prints the command and prompt without running Codex.
Logs live in `.codex-logs/<WO>-<timestamp>.{jsonl,last.md,stderr}` (gitignored).

Why the split: Codex's `workspace-write` sandbox keeps `.git/` read-only **by design** (a
writable `.git/hooks` would let the agent plant a hook that runs unsandboxed the next time a
human runs git). `--add-dir` and a writable root on the repository do not change that. So Codex
never needs a git write, never needs `--approve-for-me`, and the sandbox stays intact.
`docs/decisions.md` (2026-10-04) records the alternatives that were rejected.

## One-time setup on the Mac

1. **Codex CLI.** It ships inside the ChatGPT desktop app and is not on PATH. The script finds
   `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex` on its own; a two-line
   wrapper in `~/.local/bin/codex` that `exec`s that path makes `codex` available everywhere.
   Verify: `codex --version` (0.159.2 on 2026-10-04) and `codex exec --help`.
2. **GitHub CLI.** Codex needs `gh` to read the issue and the script needs it for the PR and the
   comment. Without it Codex falls back to driving Chrome (it did, 2026-10-04: fifteen UI steps
   and a permission prompt). Install the pinned release and verify its checksum, e.g. for
   v2.102.0 on Apple silicon:
   ```
   curl -sSLO https://github.com/cli/cli/releases/download/v2.102.0/gh_2.102.0_macOS_arm64.zip
   curl -sSLO https://github.com/cli/cli/releases/download/v2.102.0/gh_2.102.0_checksums.txt
   grep gh_2.102.0_macOS_arm64.zip gh_2.102.0_checksums.txt | shasum -a 256 -c
   unzip -q gh_2.102.0_macOS_arm64.zip && install -m 755 gh_2.102.0_macOS_arm64/bin/gh ~/.local/bin/gh
   ```
   Then `gh auth login` once (web flow). The token lives in the keychain; neither Claude nor
   Codex reads it, `gh` does.
3. **Terminal's folder permission.** macOS gates `~/Documents` per app (Privacy & Security →
   Files and Folders). If Terminal loses "Documents Folder", every tool in the session, Claude's
   own file reads included, fails with `Operation not permitted` while `ls -ld` still works.
   Re-enable it for Terminal and start a new session; a running session does not recover.
4. **Claude Code permission rule** for the bridge session, so the dispatcher can launch the script
   without a prompt: `Bash(scripts/codex-dispatch.sh:*)` in the session's allow list.

## Failure review, 2026-10-04 (WO-13)

Every failure met while dispatching WO-13, its root cause, and the fix now in place.

| # | What happened | Root cause | Root fix |
| --- | --- | --- | --- |
| 1 | `codex: command not found` | The CLI ships inside ChatGPT.app and is never added to PATH. | Script resolves the bundle path itself; `~/.local/bin/codex` wrapper for humans. |
| 2 | Run 1: Codex could not `git switch` (sandbox), then built a bare repository in `/tmp` with `GIT_DIR` pointed at the worktree and checked out `origin/main` over it, deleting and re-adding every tracked file. | `.git/` is read-only under `workspace-write` by design; the prompt had no rule against routing around a block. | Codex no longer performs any git write (script owns them). `codex-constraints.md` forbids workarounds; the watcher kills Codex on `GIT_DIR=`, `git init`, `git clone`; `AGENTS.md` carries the rule for every agent. |
| 3 | Run 2 and 3 (`--approve-for-me`) were refused by Claude Code's auto-mode classifier ("Create Unsafe Agents"), even with an allow rule for the command. | The classifier runs above allow rules and treats an auto-approving agent with network access as unsafe. | The script never needs approvals: plain `-s workspace-write`, which the classifier allowed in run 1. |
| 4 | `Exceeded skills context budget … 248 additional skills were not included`; run 1 also hit `unable to unlink old '.agents/skills'`. | `.agents/skills` was a tracked absolute symlink to `~/.lmstudio/skills`, plus `.agents/skills.json` pointing at the same folder (added 2026-09-19 in `652d00e`). | Both removed from the tree, `.agents/` gitignored. The smoke test on 2026-10-04 ran without the warning. |
| 5 | The first log watcher fired on `cat docs/engineering/PLAYBOOK.md` and `cat CONTEXT.md`. | It grepped the raw log, so the playbook's own words ("never push to main") matched. | `codex-watch.mjs` parses the JSON events and matches `command_execution` commands only; `scripts/codex-watch.test.ts` pins both the real `/tmp` workaround (must flag) and the doc read (must not). |
| 6 | `gh issue view` exited 127 inside Codex; it drove Chrome instead, which the first run's browser policy blocked. | `gh` was not installed; Homebrew is not installed either. | `gh` installed from the pinned release with checksum verification; the script refuses to run without `gh auth status`. |
| 7 | The Claude Code dispatcher could not run `codex` even after the user added `Bash(…codex exec:*)`. | Same classifier as #3: the allow rule does not bypass it. | Covered by #3; the allow rule to add is for the script, not the raw binary. |
| 8 | Codex reloaded the PR checks page about fifteen times waiting for `verify`. | It took "all gates green" as part of its job. | The constraints end Codex's job at the handoff; the PM reviews CI. |
| 9 | After run 3 every read under `~/Documents` failed with `Operation not permitted`, for the shell and for Claude's Read tool alike; `/tmp` and `~/Desktop` kept working. | macOS TCC revoked Terminal's "Documents Folder" access (the responsible app of the session is `Terminal.app`). | Owner re-enables it (setup step 3). The script keeps working from any folder the session can read; the runbook calls the symptom out so it is not mistaken for a git problem again. |
| 10 | Run 1's `git read-tree --reset -u` left the dispatcher's worktree with `origin/main` files over an older HEAD. | Consequence of #2. | Cleaned by fast-forwarding to `origin/main`; cannot recur once Codex has no `GIT_DIR` and no second repository. |
| 11 | Committing this very fix died in `.githooks/pre-commit`: `mapfile: command not found`, then `staged: unbound variable`. | The hook used bash 4's `mapfile`; macOS ships bash 3.2 (`/bin/bash`), so every commit from a Mac with the hook enabled failed. | The hook collects staged files with a `read -d ''` loop. The dispatcher enabled the hook in `.codex-workspace/` at the time; see #12. |
| 12 | PM review of PR #75: the dispatcher set `core.hooksPath .githooks` in the workspace and then ran `git commit` outside the sandbox. The hook runs `npx --no-install prettier/eslint` and `uv run --project workers/python`, which resolve `node_modules/.bin/*`, `eslint.config.*` and `pyproject.toml` from the workspace, all writable by Codex. Reproduced: a planted `node_modules/.bin/prettier` ran as the dispatching user. | Hooks are repository code; running them outside the sandbox hands Codex an unsandboxed exec. | The script unsets `core.hooksPath` (old workspaces still carry it) and commits and pushes with `-c core.hooksPath=/dev/null --no-verify`. Lint runs inside the sandbox per the constraints; CI is the gate. `scripts/codex-dispatch.test.ts` runs the script's own commit line against a workspace with a planted hook and asserts it never runs. |
| 13 | PR #78 (WO-14) needed two small fixes after review; re-running the script would have recreated `codex/wo-14-…` from `origin/main`, dropping Codex's commit, and the non-force push would then be rejected. The PM pushed the fixes by hand at the owner's request. | Step 2 always ran `switch -C <branch> origin/main`, so the dispatcher could only start a work order, never continue one. | Step 2 continues from `origin/<branch>` when it exists (and refuses if it has no open PR); the prompt carries the latest `## PM review`; the PR body is updated and the issue gets `Ready for re-review`. `scripts/codex-dispatch.test.ts` runs the base-selection block against a bare remote with and without the branch; restoring `origin/main` fails it. |

Related, not a failure: `.claude/settings.local.json` is tracked, so the allow rule the owner
added for run 3 shows as a local diff there. Keep machine-specific rules in
`~/.claude/settings.json`, or revert the file with `git checkout -- .claude/settings.local.json`.

## What the dispatcher reports

After the run: Codex's final message (`.codex-logs/<WO>-<ts>.last.md`), the PR URL, the branch
head SHA and the base SHA. The PM reviews the PR; the owner merges. Nothing in this flow pushes to
`main`, merges, deploys or applies a migration remotely.
