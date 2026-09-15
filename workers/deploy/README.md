# Running the worker on a host

The dashboard's "no worker connected" is an honest message about a real gap:
without a process claiming jobs, a customer's data is only as fresh as the last
time somebody ran the collector by hand. This is the setup that closes it.

Nothing here is specific to one provider. It assumes shell access, a Python
3.10+ interpreter, and roughly 1.5 GB of disk for the classifier and its
runtime.

## Once

```sh
python3.11 -m venv ~/sentiment-venv
~/sentiment-venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch
~/sentiment-venv/bin/pip install transformers httpx
```

The CPU wheel is deliberate: it is a fifth of the size of the default build and
these hosts have no GPU.

Copy `workers/python/src` to `~/sentiment-worker/src`, and write
`~/sentiment-worker/.env` with `chmod 600`:

```
WORKER_API_BASE_URL=https://<project>.supabase.co/functions/v1
WORKER_CREDENTIAL=<the scoped worker credential>
GEMINI_API_KEY=<the Gemini key, for topic classification>
```

Without it the worker still collects and labels sentiment; topic jobs are reported blocked with `no_topic_classifier`.

A credential is scoped to one workspace and is the only kind of secret on the
host. It is not a Supabase key and cannot read anything but its own queue.

To serve more than one workspace from one machine, list their credentials
comma-separated:

```
WORKER_CREDENTIAL=<first>,<second>
```

The loop takes them in turn rather than in order, so a busy tenant cannot
starve a quiet one, and a round counts as idle only when every credential came
back empty. The classifier is loaded once and shared, which is the reason to
run one worker over several tenants rather than one process each.

## Order of a deploy that adds a job type

The worker service and the `worker` Edge Function go out **before** the
migrations that teach the queue a new job type — for topic classification, the
three migrations `20260916010000`–`20260916012000`. A worker built before
that change treats any job that is not `discover` as a collection: handed an
`analyse` job by a queue that already knows the type, it walks the empty
due-video list the claim carries (the gateway asks for one only on a
`collect` claim) and marks the job `succeeded` having classified nothing —
and the tick will not queue another while that one counts as done. As a
guard, `worker_due_videos` raises `invalid_job_type` for anything but
`collect`, so a gateway that did ask on the worker's behalf is refused rather
than answered; a refused job is still a job that ran and failed. Update the
service, redeploy the function, then push the migrations.

## Continuously

`run-worker.sh` in this directory starts one worker under `flock`. Schedule it:

```
*/5 * * * * $HOME/sentiment-worker/run-worker.sh
```

Cron is a restarter, not a scheduler of work: while a worker holds the lock the
five-minute tick is a no-op.

A jitter is worth adding so that every host does not restart on the same
second, but keep it out of the crontab unless you know what `/bin/sh` is on
that machine. A line like `sleep $((RANDOM \% 60)) && …` depends on `sh` being
bash; under dash `$RANDOM` is empty, the arithmetic fails, and the worker
silently never starts. The deployment this was built against happens to link
`/bin/sh` to bash — which is a fact about that host, not a guarantee. The loop stands down by itself after a stretch of
empty cycles, and the next tick starts a clean process — long-lived Python
accumulates memory, and a scheduled restart is simpler than diagnosing that
later.

## When it stops working without stopping

`flock -n` makes cron a no-op while a worker holds the lock. That is right while
the worker is alive and wrong while it is stuck: a hung process holds the lock
for as long as it hangs, and the five-minute tick restarts nothing. On
2026-09-14 a worker held its lease, stopped heartbeating, and sat there for
twenty-five minutes with no replacement possible.

`watchdog.sh` is the missing half. It never starts a worker — it ends one that
has stopped working and lets `run-worker.sh` start a clean replacement, which it
then can, because the lock is free. Two things that can both start a worker is
how you get two workers.

```
*/5 * * * * $HOME/sentiment-worker/run-worker.sh
*/2 * * * * $HOME/sentiment-worker/watchdog.sh
```

Liveness is judged by the log's modification time, because that is the one thing
a working worker touches continuously and a hung one does not. Process CPU time
would miss a worker spinning in a retry loop, and the job lease would need
database credentials this script deliberately does not hold. The default is ten
minutes of silence — longer than the lease plus the slowest plausible batch —
and `SILENT_SECONDS` overrides it.

TERM first, so a worker mid-commit can finish: the loop installs a handler that
completes the job in hand and leaves. KILL only for a process that ignores it.

## Watching it

`~/sentiment-worker/worker.log` is timestamped and truncated when it passes
5 MB. The product's own view is the operations page, which reads what the runs
recorded rather than what the log says.

## Thread count

`OMP_NUM_THREADS=1` is not tuning. torch sizes its pool from the machine's core
count, which on a shared account exceeds the process limit and fails outright
before a single comment is read. Thread count does not change the output, so it
is not part of the analysis key.
