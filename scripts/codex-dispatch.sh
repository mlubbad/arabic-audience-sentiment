#!/usr/bin/env bash
# Dispatch one work order to the Codex CLI from the owner's Mac.
#
# Division of labour (see docs/engineering/codex-dispatch.md):
#   - Codex edits and tests inside its own sandbox (workspace-write, network on).
#     That sandbox keeps `.git/` read-only by design, so Codex never runs a git
#     write and never needs `--approve-for-me` or `danger-full-access`.
#   - This script owns every git write: branch, commit, push, the PR and the
#     "Ready for review" / "Ready for re-review" comment. Codex hands over its
#     commit message and PR text through `.codex-handoff/` (gitignored).
#
# Usage:
#   scripts/codex-dispatch.sh <WO-N> <issue-number> <codex/wo-N-slug> [extra prompt]
# Run the same command again after a PM review for a follow-up round: when the
# branch already exists on origin with an open PR, the script continues from its
# tip, hands Codex the latest "## PM review" as data, and pushes a fast-forward.
# Env:
#   CODEX_WORKSPACE  dedicated clone Codex works in (default: <repo>/.codex-workspace)
#   CODEX_BIN        path to the codex binary (default: PATH, then the ChatGPT.app bundle)
#   CODEX_DRY_RUN=1  prepare the workspace and print the command, do not run Codex
#   CODEX_ALLOW_WORKFLOWS=1  let this work order change .github/workflows/**
set -euo pipefail

die() { echo "codex-dispatch: $*" >&2; exit 1; }
usage() {
  echo "usage: $0 <WO-N> <issue-number> <codex/wo-N-slug> [extra prompt]" >&2
  exit 2
}

[ $# -ge 3 ] || usage
wo="$1" issue="$2" branch="$3"
shift 3
extra="${*:-}"
[[ "$wo" =~ ^WO-[0-9]+[a-z]?$ ]] || die "work order must look like WO-14, got '$wo'"
[[ "$issue" =~ ^[0-9]+$ ]] || die "issue number must be numeric, got '$issue'"
[[ "$branch" =~ ^codex/wo-[0-9]+[a-z]?-[a-z0-9-]+$ ]] || die "branch must be codex/wo-N-slug, got '$branch'"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
remote_url="$(git -C "$repo_root" remote get-url origin)"
workspace="${CODEX_WORKSPACE:-$repo_root/.codex-workspace}"
logs="$repo_root/.codex-logs"
mkdir -p "$logs"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
log="$logs/$wo-$stamp.jsonl"
last="$logs/$wo-$stamp.last.md"
errlog="$logs/$wo-$stamp.stderr"
constraints="$repo_root/docs/agents/dispatch/codex-constraints.md"
[ -f "$constraints" ] || die "missing $constraints"
[ -f "$repo_root/docs/agents/work-orders/$wo.md" ] || die "missing docs/agents/work-orders/$wo.md on this checkout"

# --- 1. tools --------------------------------------------------------------
codex_bin="${CODEX_BIN:-$(command -v codex || true)}"
bundled="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"
[ -n "$codex_bin" ] || { [ -x "$bundled" ] && codex_bin="$bundled"; }
[ -n "$codex_bin" ] || die "codex CLI not found on PATH or at $bundled"
"$codex_bin" exec --help >/dev/null 2>&1 || die "'codex exec' (non-interactive mode) is unavailable in $("$codex_bin" --version)"
command -v node >/dev/null || die "node not found"
command -v gh >/dev/null || die "gh not found (install steps: docs/engineering/codex-dispatch.md)"
if ! gh auth status >/dev/null 2>&1; then
  if [ "${CODEX_DRY_RUN:-0}" = "1" ]; then
    echo "codex-dispatch: warning: gh is not logged in; the real run needs 'gh auth login' once" >&2
  else
    die "gh is not logged in; run 'gh auth login' once (web flow) and retry"
  fi
fi

# --- 2. workspace ----------------------------------------------------------
if [ ! -d "$workspace/.git" ]; then
  echo "codex-dispatch: cloning $remote_url into $workspace"
  git clone --quiet "$remote_url" "$workspace"
fi
git -C "$workspace" fetch --quiet origin main
if [ -n "$(git -C "$workspace" status --porcelain)" ]; then
  die "workspace has uncommitted changes from an earlier run: $workspace (inspect, then 'git reset --hard && git clean -fd' there)"
fi
# BEGIN base selection (pinned by scripts/codex-dispatch.test.ts)
# A branch already on origin is a follow-up round: continue from its tip, so the
# earlier commits and the open PR survive and the push stays a fast-forward.
# Only a branch that does not exist yet starts from origin/main.
if git -C "$workspace" ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  git -C "$workspace" fetch --quiet origin "+refs/heads/$branch:refs/remotes/origin/$branch"
  base_ref="origin/$branch"
  round="follow-up"
else
  base_ref="origin/main"
  round="first"
fi
git -C "$workspace" switch --quiet -C "$branch" "$base_ref"
# END base selection
# The repository hooks must never run here. Every git command after Codex runs
# outside its sandbox, and a hook resolves tools from the workspace Codex could
# write (node_modules/.bin, eslint.config.*, workers/python/pyproject.toml), so a
# hook would execute Codex-planted code as the owner. Unset it as well, because
# workspaces from earlier runs of this script still carry it. Lint runs inside
# the sandbox (codex-constraints.md) and CI is the gate.
git -C "$workspace" config --unset core.hooksPath || true
rm -rf "$workspace/.codex-handoff"
mkdir -p "$workspace/.codex-handoff"
if [ ! -d "$workspace/node_modules" ] && [ "${CODEX_DRY_RUN:-0}" != "1" ]; then
  echo "codex-dispatch: first run in this workspace, installing dependencies (npm run setup)"
  (cd "$workspace" && npm run setup)
fi
base_sha="$(git -C "$workspace" rev-parse HEAD)"
echo "codex-dispatch: $branch @ $base_sha ($base_ref, $round round) in $workspace"

# --- 3. prompt -------------------------------------------------------------
# Built with printf, not a heredoc: macOS ships bash 3.2, which rejects a
# command substitution nested inside a heredoc inside "$( )".
constraints_text="$(cat "$constraints")"
if [ "$round" = "first" ]; then
  task="نفّذ $wo من docs/agents/work-orders/$wo.md (issue #$issue). أنت الآن على الفرع $branch المُنشأ من آخر origin/main. اتبع AGENTS.md وdocs/engineering/PLAYBOOK.md."
  review=""
else
  # The PM's latest review on the open PR, fetched here (outside the sandbox,
  # fixed arguments) because Codex has no GitHub credentials. It is passed as
  # data inside the prompt, never executed.
  open_pr="$(gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty')"
  [ -n "$open_pr" ] || die "$branch exists on origin but has no open PR; a closed or merged branch is not continued"
  review="$(gh pr view "$open_pr" --json reviews --jq '[.reviews[] | select(.body | startswith("## PM review"))] | sort_by(.submittedAt) | last | .body // ""')"
  [ -n "$review" ] || die "no PM review found on PR #$open_pr; nothing for a follow-up round to address"
  task="جولة تعديل على $wo (issue #$issue, PR #$open_pr). أنت على الفرع $branch من آخر رأس له على origin، والتزاماتك السابقة موجودة. عالج بنود مراجعة PM أدناه فقط، ثم حدّث .codex-handoff كالعادة (commit.txt لهذا الالتزام فقط، وpr.md بالنص الكامل المحدّث للـPR). اتبع AGENTS.md وdocs/engineering/PLAYBOOK.md."
fi
prompt="$(printf '%s\n' "$task" "$extra" "" "$review" "" "$constraints_text")"

codex_cmd=("$codex_bin" exec -C "$workspace" -s workspace-write
  -c sandbox_workspace_write.network_access=true
  --color never --json -o "$last")

if [ "${CODEX_DRY_RUN:-0}" = "1" ]; then
  echo "codex-dispatch: dry run; would execute:"
  printf '  %q' "${codex_cmd[@]}" "<prompt>"
  echo
  echo "--- prompt ---"
  echo "$prompt"
  exit 0
fi

# --- 4. run Codex under the watcher ---------------------------------------
echo "codex-dispatch: log $log"
"${codex_cmd[@]}" "$prompt" </dev/null >"$log" 2>"$errlog" &
codex_pid=$!
set +e
node "$script_dir/codex-watch.mjs" --log "$log" --pid "$codex_pid"
watch_status=$?
wait "$codex_pid"
codex_status=$?
set -e

echo
echo "== Codex final message"
[ -s "$last" ] && cat "$last" || echo "(none; see $errlog)"
echo
[ "$watch_status" -eq 0 ] || die "the watcher flagged a forbidden command (exit $watch_status); nothing was committed. Log: $log"
[ "$codex_status" -eq 0 ] || die "codex exited with status $codex_status; nothing was committed. Log: $log, stderr: $errlog"

# --- 5. guards before any git write ---------------------------------------
cd "$workspace"
[ -n "$(git status --porcelain)" ] || die "Codex made no changes; nothing to commit"
# The agent tooling and the Claude-owned files never ride a work-order commit.
protected=(.githooks .claude .gitleaksignore .codex-handoff
  scripts/codex-dispatch.sh scripts/codex-watch.mjs docs/agents/dispatch
  AGENTS.md CLAUDE.md GEMINI.md docs/progress.md docs/verification.md
  docs/decisions.md docs/adr)
# All of .github/ unless the work order owns workflows; then only workflows open up.
if [ "${CODEX_ALLOW_WORKFLOWS:-0}" = "1" ]; then
  protected+=(.github/ISSUE_TEMPLATE .github/dependabot.yml .github/pull_request_template.md)
else
  protected+=(.github)
fi
for p in "${protected[@]}"; do
  if [ -n "$(git status --porcelain -- "$p")" ]; then
    die "Codex touched protected path '$p'; nothing was committed. Inspect $workspace"
  fi
done
[ -s .codex-handoff/commit.txt ] || die "Codex did not write .codex-handoff/commit.txt; nothing was committed"
[ -s .codex-handoff/pr.md ] || die "Codex did not write .codex-handoff/pr.md; nothing was committed"
title="$(head -n 1 .codex-handoff/pr.md)"
body="$(tail -n +2 .codex-handoff/pr.md)"
[[ "$title" == "$wo: "* ]] || die "PR title must start with '$wo: ', got '$title'"
case "$body" in
  *"Closes #$issue"*) ;;
  *) body="Closes #$issue"$'\n\n'"$body" ;;
esac

# --- 6. commit, push, PR, issue comment -----------------------------------
# Hooks off for both writes: they run outside the sandbox (see step 2).
git add -A
git -c core.hooksPath=/dev/null commit --no-verify --quiet -F .codex-handoff/commit.txt
head_sha="$(git rev-parse HEAD)"
git -c core.hooksPath=/dev/null push --no-verify -u origin "$branch"
pr_url="$(gh pr list --head "$branch" --state open --json url --jq '.[0].url // empty')"
if [ -z "$pr_url" ]; then
  pr_url="$(gh pr create --base main --head "$branch" --title "$title" --body "$body")"
  ready="Ready for review"
else
  gh pr edit "$pr_url" --body "$body" >/dev/null
  ready="Ready for re-review"
fi
pr_num="${pr_url##*/}"
gh issue comment "$issue" --body "$ready: PR #$pr_num @ ${head_sha:0:7}"

echo "== Report"
echo "work order: $wo (issue #$issue)"
echo "branch:     $branch @ $head_sha (base $base_sha)"
echo "PR:         $pr_url"
echo "issue:      commented '$ready: PR #$pr_num @ ${head_sha:0:7}'"
echo "log:        $log"
