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
```

The credential is scoped to one workspace and is the only secret on the host.
It is not a Supabase key and cannot read anything but its own queue.

## Continuously

`run-worker.sh` in this directory starts one worker under `flock`. Schedule it:

```
*/5 * * * * $HOME/sentiment-worker/run-worker.sh
```

Cron is a restarter, not a scheduler of work: while a worker holds the lock the
five-minute tick is a no-op. The loop stands down by itself after a stretch of
empty cycles, and the next tick starts a clean process — long-lived Python
accumulates memory, and a scheduled restart is simpler than diagnosing that
later.

## Watching it

`~/sentiment-worker/worker.log` is timestamped and truncated when it passes
5 MB. The product's own view is the operations page, which reads what the runs
recorded rather than what the log says.

## Thread count

`OMP_NUM_THREADS=1` is not tuning. torch sizes its pool from the machine's core
count, which on a shared account exceeds the process limit and fails outright
before a single comment is read. Thread count does not change the output, so it
is not part of the analysis key.
