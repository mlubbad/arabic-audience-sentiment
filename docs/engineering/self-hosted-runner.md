# Self-hosted CI runner (runbook)

Owner-run. Use it when GitHub refuses hosted jobs (2026-10-10: "recent account payments have
failed or your spending limit needs to be increased"), or whenever hosted minutes run out.
The decision and its trade-offs are in `docs/adr/0002-switchable-ci-runner.md`.

## How the switch works
Every job reads its machine from a repository variable:

| Variable | Jobs | Unset (default) |
| --- | --- | --- |
| `CI_RUNNER` | `ci.yml`, `security.yml`, `codeql.yml`: all PR and `main` checks | `ubuntu-latest` (GitHub-hosted) |
| `DEPLOY_RUNNER` | `deploy.yml`: the deploy gate and the production deploy | `ubuntu-latest` (GitHub-hosted) |

Setting a variable to a runner's label moves those jobs to that runner. Deleting it moves them
back. No workflow file changes either way. `scripts/workflow-runners.test.ts` fails if a job
stops reading its variable.

## 1. Create the Linux machine (once)
The workflows are written for Ubuntu, so the runner is an Ubuntu 24.04 VM, not macOS itself.
On an Apple Silicon Mac this VM is arm64. Every job supports that: Node, uv, Chromium
(Playwright), the Semgrep image (multi-arch), CodeQL (Ubuntu 22.04/24.04 on arm64) and the
gitleaks step (picks the archive for `RUNNER_ARCH`).

[Multipass](https://canonical.com/multipass) is free and needs no account:

```bash
brew install --cask multipass
```

```bash
multipass launch 24.04 --name aas-runner --cpus 4 --memory 8G --disk 40G
```

```bash
multipass shell aas-runner
```

Inside the VM, as the default `ubuntu` user (it has passwordless `sudo`, which
`npx playwright install --with-deps` needs, just as on a hosted runner):

```bash
sudo apt-get update && sudo apt-get install -y git curl jq unzip build-essential docker.io gh
```

```bash
sudo usermod -aG docker ubuntu
```

Then `exit` and `multipass shell aas-runner` again, so the `docker` group applies. The Semgrep
job runs inside a container and needs Docker.

Put nothing else on this VM: no SSH keys, no `.env`, no cloud or Supabase credentials. It runs
code from every branch, including agent branches.

## 2. Register the runner (once)
1. On GitHub: repository **Settings → Actions → Runners → New self-hosted runner**, choose
   **Linux** and **ARM64**. The page shows the download and `config.sh` commands with a one-time
   token. Use those commands, in a new folder `~/actions-runner-1` inside the VM.
2. Run `config.sh` with a label and a name:
   `./config.sh --url https://github.com/mlubbad/arabic-audience-sentiment --token <from the page> --labels aas-ci --name aas-ci-1 --unattended`
3. Install it as a service, so it survives a reboot:

```bash
sudo ./svc.sh install && sudo ./svc.sh start
```

**Speed.** One runner runs one job at a time. A push to a PR starts 10 jobs (5 CI, 3 Security,
2 CodeQL; a push to `main` starts 8, without CodeQL), so a single runner runs them in turn. It's slower than hosted, but it finishes.
To run them in parallel, repeat step 2 in `~/actions-runner-2`, `-3` with the same label
`aas-ci` and names `aas-ci-2`, `aas-ci-3`, and give the VM more memory. The jobs write only to
their own `RUNNER_TEMP`, so runners on one VM don't collide.

## 3. Switch CI over
```bash
gh variable set CI_RUNNER --body aas-ci --repo mlubbad/arabic-audience-sentiment
```

Re-run the PR's checks (the PR's **Checks** tab → **Re-run all jobs**). Each job's log starts
with `Runner name: aas-ci-1`. A job that waits as "Queued" means no runner with the label
`aas-ci` is online. Check it with `sudo ./svc.sh status` in the runner folder.

**Back to hosted** once billing works again:

```bash
gh variable delete CI_RUNNER --repo mlubbad/arabic-audience-sentiment
```

## 4. Deploys (only if you need them while hosted is blocked)
`DEPLOY_RUNNER` stays unset by default, and **never points at `aas-ci`**. The deploy job holds
the production credentials (FTP, Supabase access token). The CI runner is persistent and runs
agent-written code, and a job can leave something behind that a later job would run. If deploys
must run self-hosted, use a **second VM** (repeat step 1 with `--name aas-deploy-vm`). Register a
runner there with the label `aas-deploy` and the `--ephemeral` flag: it takes one job, then
unregisters, and is registered again with a fresh token. Then:

```bash
gh variable set DEPLOY_RUNNER --body aas-deploy --repo mlubbad/arabic-audience-sentiment
```

## Rules that keep this safe
- **Private repository only.** If the repository ever becomes public, first run
  `gh variable delete CI_RUNNER` and remove the runner. On a public repository, anyone's pull
  request would run on this VM.
- **Keep fork workflows off.** In **Settings → Actions → General → Fork pull request workflows
  in private repositories**, leave "Run workflows from fork pull requests" unchecked.
- **Labels, not `self-hosted`.** Jobs ask for `aas-ci` by name, so another runner registered
  later can't pick them up by accident.
- **Cost.** GitHub's docs say self-hosted runner usage is free. A per-minute charge for
  self-hosted runners was announced for 2026-03-01 and then postponed (GitHub changelog update,
  2025-12-17). If it comes back, self-hosted minutes would count against the same quota.
