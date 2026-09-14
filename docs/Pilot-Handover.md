# Pilot handover

What this is, what it does, what it does not do, and what it would take to
extend it. Written for the person deciding whether to put a real channel
through it.

## What it does today

A YouTube channel is connected by its owner through Google's own consent
screen. A worker collects the comments on that channel's uploads, a pinned
Arabic classifier labels each one, and a dashboard reports what the audience
said, when, and who said it.

All of it has been run end to end against a real channel:

| | |
|---|---|
| Comments collected | 326, across 34 videos |
| Labelled | 326 — one prediction per comment, one analysis |
| Distribution | 194 negative · 69 positive · 63 neutral |
| Longest run | 154 seconds, complete traversal |
| Worker | continuous, unattended, two workspaces |

## The model, and what its numbers mean

`CAMeL-Lab/bert-base-arabic-camelbert-da-sentiment`, pinned to commit
`b0df630d`. Dialectal Arabic, three classes: positive, negative, neutral.

Its label mapping is verified against the checkpoint's own configuration at
load time rather than trusted. A model with the right label names in a
different order loads cleanly, runs, and inverts every verdict — nothing on our
side would notice, so a mismatch refuses to run.

**We do not know how accurate it is on this audience.** That is not a figure of
speech. One sampled comment — "اظن انه في الجزيرة", a neutral remark — was
labelled negative at 0.518 confidence, barely above a coin toss. The
distribution above is a measurement of the model's behaviour, not of the
audience's mood, and the two should not be confused in front of a client.

Establishing the difference needs a golden set: a few hundred comments labelled
by people, drawn by the sampling tool already in the repository
(`npm run label:draw`), scored by the tool beside it (`npm run label:score`),
which reports macro-F1 with confidence intervals. Until that exists, the honest
framing is "labelled by a published Arabic model" and never "the audience is
60% negative".

The dashboard is built so that this stays visible: every figure states its
denominator, unlabelled comments are counted and excluded from every
percentage, and a correction made by a person overrides the model and moves
every aggregate with it.

## What it deliberately does not do

**Topics.** The reference report groups comments into themes. That needs a
language-model layer which has not been built. Clustering by keyword would
produce topic names nobody chose and a chart that looks like analysis, so the
panel says it is unavailable instead.

**Recommended actions.** Same reason.

**Video reach.** Views, likes and subscriber counts are not collected. Every
per-video figure on the dashboard is derived from the comments held, and says
so.

**Comment types.** The question/suggestion dimension exists in the schema and
nothing writes it, so the control is hidden rather than offered as a filter
that cannot change the answer.

## Known limits

**The dashboard reads every filtered row.** 326 comments is about 226 kB of
table data; the serialised snapshot is larger. A channel with tens of thousands
of comments would make this a multi-megabyte read on every load. Moving the
aggregation into SQL and paginating is the first scaling task, and it is the
one that arrives first.

**One quota, one channel at a time.** A backfill walks a channel as a single
resumable job. Two channels in one workspace queue behind each other by design:
the rule is one outstanding collection per channel.

**Google OAuth.** The application's consent screen governs who may connect. A
client outside the approved testers cannot connect until the app is verified or
they are added.

**No billing.** The pilot plan is a row in the database — no provider, nothing
charged. Allowances are enforced (5,000 analyses, 20,000 backfill units per
period) and metered per unique comment, so a retry, a re-import or a
re-analysis after an edit costs nothing extra.

## Operating it

The worker runs on a host under cron, which restarts it rather than scheduling
work; while one holds its lock the tick is a no-op. Setup is in
`workers/deploy/README.md`. The only secret on that machine is a worker
credential scoped to one workspace, which can read nothing but its own queue.

Retention runs inside the database on a schedule: comment text is purged after
thirty days, abandoned OAuth handshakes after seven. The text belongs to people
who are not the customer, and a purge removes it while keeping the row, its
labels and its coverage — the dashboard tells "no text" apart from "text
deleted under the retention rule".

The operations page is the control surface: worker state, plan usage, every
attempt with the reason attached, and — for work that has not started or has
finished without succeeding — withdraw and retry. A retry queues a new job and
carries the checkpoint over, so a backfill that stopped halfway resumes instead
of re-reading the channel.

## What would come next, in order

1. **The golden set.** Everything about how much to trust the labels waits on
   it, and it is the cheapest thing on this list.
2. **Server-side aggregation.** The limit above arrives with the first large
   channel.
3. **Topics.** The largest gap against the reference, and the one a client is
   most likely to ask for.
4. **Billing.** The subscription row is already shaped for a provider
   reference.
