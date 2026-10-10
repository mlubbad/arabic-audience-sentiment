# 0002. Switchable CI runner (hosted by default, self-hosted on demand)
Status: proposed
Date: 2026-10-10

## Context
- On 2026-10-10 GitHub refused every hosted job on PR #108, three attempts in a row, each within
  2 seconds and before any step ran: "The job was not started because recent account payments
  have failed or your spending limit needs to be increased". Another branch
  (`claude/keen-keller-skwwpm`) was refused the same way. With no job running, the five
  required gates can't pass, so nothing can merge, and `deploy.yml` can't deploy.
- Every job named `runs-on: ubuntu-latest` directly. Moving off hosted runners meant editing all
  11 jobs, and moving back meant editing them again.
- The block applies to GitHub-hosted runners. GitHub's billing docs say self-hosted runner usage
  is free, and the announced self-hosted per-minute charge was postponed (changelog update,
  2025-12-17). In the public reports of this same message (community discussions 151956 and
  207969, September 2026), required checks ran on a self-hosted runner while hosted jobs were
  refused.
- The secret scan downloaded the `linux_x64` gitleaks build into `/usr/local/bin`. That fails on
  an arm64 machine (the owner's Mac) and for a non-root runner user. The dependency audit wrote
  to `/tmp`, which a persistent machine shares between jobs.

## Decision
- **One variable per trust level.** Every job in `ci.yml`, `security.yml` and `codeql.yml` runs
  on `${{ vars.CI_RUNNER || 'ubuntu-latest' }}`. Both `deploy.yml` jobs run on
  `${{ vars.DEPLOY_RUNNER || 'ubuntu-latest' }}`. Unset, nothing changes.
- **Deploy never follows CI by accident.** CI runs code from every agent's branch. The deploy
  holds the production credentials. On a persistent runner one job can affect the next, so the
  two are switched separately, and the runbook requires a separate, ephemeral runner for deploys.
- **Runner-neutral steps.** gitleaks picks its archive from `RUNNER_ARCH` (X64 or ARM64; any
  other value fails loudly), still verifies the checksum, and installs into `RUNNER_TEMP`. The
  dependency audit writes to `RUNNER_TEMP` instead of `/tmp`.
- **Guarded by a test.** `scripts/workflow-runners.test.ts` fails if any job hard-codes its
  runner, if a deploy job uses `CI_RUNNER`, or if the security workflow goes back to
  `/usr/local/bin` or `/tmp`.
- **Owner-operated.** The runner lives in an Ubuntu 24.04 VM the owner runs. Setup, switching and
  safety rules are in `docs/engineering/self-hosted-runner.md`.

## Consequences
- **Easier:** a billing block or exhausted minutes no longer stops the gates. One variable moves
  CI to the owner's machine, and deleting it moves CI back. With the variables unset, hosted CI
  behaves exactly as before.
- **Harder:** the owner keeps a VM running and the runner online. A single runner runs a PR push's
  10 jobs one after another, so it's slower than hosted until more runners are added.
- **Watch:**
  - **Parity:** the VM is linux/arm64, while hosted is linux/x64. Browser tests have shown
    Linux-only flakes before. A failure seen only on the self-hosted runner is compared against a
    hosted run before anyone fixes it.
  - **Exposure:** the VM runs agent-written code. It holds no credentials, the repository stays
    private, and fork workflows stay off. Making the repository public requires removing the
    runner first.
  - **Cost:** if GitHub reintroduces the self-hosted platform charge, those minutes count against
    the same quota. This decision is then revisited.
