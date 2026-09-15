# Topic classification — design

2026-09-15. Approved in conversation; this is the written form.

## What changes and why

The dashboard's Topics card says "Not available yet" and explains that sorting comments into
topics needs a language-model layer that has not been built ([Dashboard.tsx:1240]). The
handoff's reference report grouped comments into themes, and its A3 findings record three
legacy topic names whose counts never reconciled. Nothing in the repository classifies a
comment by what it is *about*; sentiment is the only dimension analysed.

After this work every audience comment and reply gets one primary topic from a per-workspace
taxonomy, decided by Gemini through the Python worker, stored with the same staleness
discipline as sentiment (current text hash, active classification key, newest human review
wins), shown on the dashboard as a chart and a per-row chip, filterable together with every
other figure on the page, exported in the CSV, correctable by a member with a reason, and
metered as its own plan unit.

Decisions taken with the user:

- **Fixed default taxonomy, per-workspace override; one primary topic per comment.** Gemini
  chooses from a list. No open-ended topic invention, no secondary topic.
- **A separate classification pass**, not inline with the sentiment batch. Collection and
  sentiment never wait on Gemini; already-collected comments are covered by the same pass.
- **Metered as its own kind**, `topic_classification`, with its own plan allowance.
- **Full dashboard integration**: chart, shared filter, per-row chip, CSV columns, and
  append-only human corrections.
- **Replies are classified with their parent's text as context.** A reply of "آمين" alone is
  unclassifiable; with its parent it is not.
- **The model is pinned** (`gemini-2.5-flash`) and named in the classification key, so a
  model change is a new key, as a sentiment model change is.

Decisions made in design, not asked:

- **Dedicated tables mirroring the sentiment pair** rather than `comment_annotations`. The
  annotations table has no `content_hash` (an edited comment would keep its stale topic), no
  status (a Gemini failure could not be recorded as failed rather than absent), and its manual
  rows carry no reviewer or reason. Adding all three would be the dedicated design under a
  worse name.
- **An `analyse` job scheduled by the tick** rather than an idle-time sweep. `jobs.type`
  already allows `'analyse'` and nothing uses it. Leases, heartbeats, retries, backoff and the
  Sync page's job feed come for free, and a Gemini outage is a `partial` job like any failed
  fetch. A sweep with no job row would be invisible and unrecorded.
- **Gemini receives comment text, parent text and the taxonomy only.** No author names,
  channel ids, comment ids or workspace identifiers leave the worker. This is the first time
  comment text goes to a third party and is recorded in `docs/decisions.md`.
- **The taxonomy-editing UI is not in this pass.** Workspaces are seeded with the defaults and
  the `set_workspace_topics` RPC exists, so a later settings screen has something to call.

## Default taxonomy

Seeded into every workspace on creation, and into existing workspaces by the migration. Keys
are stable slugs; names are display text in both locales; descriptions are what the prompt
tells Gemini.

| key | name_ar | name_en | description (prompt) |
| --- | --- | --- | --- |
| `question` | استفسارات وأسئلة | Questions & inquiries | Asks the creator or others something, or requests information. |
| `religious` | دعاء وذكر وتعبير ديني | Prayers & religious remarks | Prayer, supplication, remembrance of God, religious phrasing as the main content. |
| `praise` | إشادة ودعم | Praise & support | Compliments, thanks, encouragement toward the creator or content. |
| `criticism` | نقد واعتراض | Criticism & objection | Disagreement, complaint, or negative judgement of the content, creator or subject. |
| `request` | طلبات واقتراحات | Requests & suggestions | Asks for future content, features, changes, or makes a suggestion. |
| `discussion` | نقاش وتحليل الموضوع | Discussion of the subject | Substantive commentary on the topic of the video itself. |
| `personal` | تجارب وقصص شخصية | Personal stories & experiences | Shares the commenter's own situation or experience. |
| `humour` | مزاح ودعابة | Humour & banter | Jokes, memes, playful remarks. |
| `promotion` | ترويج ومحتوى دعائي | Promotion & spam | Advertising, self-promotion, links, repeated off-purpose content. |
| `other` | خارج الموضوع / أخرى | Off-topic / other | Does not fit the above or is unrelated to the video. |

`other` is a real topic, not a failure state. A verdict that could not be produced is a
`failed`/`skipped`/`unsupported` prediction, never `other`.

## Schema

One migration, `20260915160000_a_comment_has_a_topic.sql`.

### `public.workspace_topics`

```
workspace_id uuid not null references public.workspaces(id)
key          text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$')
name_ar      text not null check (length(name_ar) between 1 and 80)
name_en      text not null check (length(name_en) between 1 and 80)
description  text not null check (length(description) between 1 and 400)
position     int  not null
retired_at   timestamptz null
primary key (workspace_id, key)
```

Row-level security: tenant read via `private.has_role(workspace_id)`; no direct tenant write.
`set_workspace_topics(w uuid, topics jsonb)` (owner only) replaces the active set: rows absent
from the payload are retired, not deleted, because predictions reference them; it then
increments `workspaces.topic_taxonomy_version` and nulls `workspaces.active_topic_key`. An
insert trigger on `public.workspaces` seeds the defaults; the migration seeds them into every
existing workspace.

### `public.workspaces`

- `topic_taxonomy_version int not null default 1`.
- `active_topic_key text null`. Set by an insert trigger on `topic_predictions` when null
  (the same rule as `first_analysis_becomes_active`); reset by `set_workspace_topics`. On the
  workspace rather than the channel because the taxonomy is per workspace.

### `public.topic_predictions`

```
id                 uuid primary key default gen_random_uuid()
workspace_id       uuid not null
comment_id         uuid not null
content_hash       text not null
classification_key text not null
status             text not null check (status in ('succeeded','skipped','failed','unsupported'))
topic_key          text null
confidence         numeric(4,3) null check (confidence between 0 and 1)
model_id           text not null
prompt_version     text not null
error_code         text null
predicted_at       timestamptz not null default now()
check ((status = 'succeeded') = (topic_key is not null))
unique (workspace_id, comment_id, content_hash, classification_key)
foreign key (workspace_id, comment_id) references public.comments (workspace_id, id)
foreign key (workspace_id, topic_key) references public.workspace_topics (workspace_id, key)
```

`classification_key = 'topics:v' || taxonomy_version || '+' || model_id || '+' || prompt_version`,
computed by the server and echoed by the worker. There is no `analysis_runs` equivalent; the
key already carries everything a run row would.

### `public.topic_reviews`

```
id           uuid primary key default gen_random_uuid()
workspace_id uuid not null
comment_id   uuid not null
content_hash text not null
topic_key    text not null
reviewer_id  uuid not null references auth.users(id)
reason       text not null check (length(trim(reason)) between 1 and 500)
origin       text not null default 'human' check (origin in ('human'))
created_at   timestamptz not null default now()
foreign key (workspace_id, comment_id) references public.comments (workspace_id, id)
foreign key (workspace_id, topic_key) references public.workspace_topics (workspace_id, key)
```

Append-only via the existing `private.reject_review_mutation()` trigger. Tenant read via
`has_role`; writes only through `submit_topic_review(w, comment_id, content_hash, topic_key,
reason)`, which refuses a stale `content_hash`, a retired or unknown topic, and a non-member,
and writes an `audit_events` row, mirroring `submit_comment_review`.

### Metering

- `usage_events.event_type` check gains `'topic_classification'`.
- `plans.topic_units int not null default 0`; the `pilot` row is set to 5000.
- `private.reserve_usage` accepts the new kind, with `plans.topic_units` as its allowance.
- `usage_summary` returns a third `budget_entry('topic_classification', ...)`.
- Event key `topics:youtube:<external_comment_id>`. A comment is charged once ever, not once
  per retry, re-classification, or taxonomy version. Only `succeeded` verdicts are charged.

### Snapshot

`private.dashboard_snapshot_impl` adds:

- `topics`: the workspace's taxonomy, retired rows included with `retired: true`, ordered by
  `position`.
- `active_topic_key`.
- Per row, `topic_prediction` (the newest prediction on the row's current hash under the
  active key, or null) and `topic_reviews` (all reviews for the row), with the same selection
  rule as `prediction` and `reviews`.

### Worker RPCs

`private.worker_topics_due(token_hash, job_id, lease_token, max_rows)` — lease-checked; returns
up to `max_rows` (cap 200) rows for the job's channel whose current hash has no prediction
under the workspace's active key — or, when that key is null, no prediction under the key
the server would assign — plus rows whose latest prediction under that key is `failed`. Each
row carries `external_comment_id, content_hash, text, parent_text, is_reply`; `parent_text`
is the parent's `text_raw` or null. Rows with `content_purged_at` set are returned with
`text = null` so the worker records them `unsupported` rather than sending nothing. The
response also carries `classification_key` and `taxonomy` (key + description) so the worker
never computes the key or invents a topic list.

`private.worker_commit_topics(token_hash, job_id, lease_token, batch_key, records jsonb)` —
lease-checked and batch-idempotent through `private.job_batches`, exactly as `commit-batch`.
Reserves `topic_classification` units for the `succeeded` records, all-or-nothing
(`quota_exceeded`, errcode `53400`), then inserts predictions `on conflict do nothing`.

`private.schedule_due_work` (the tick) enqueues one `analyse` job per channel that has at
least one due row, dedupe key `topics:<channel_id>:<taxonomy_version>`, `not_before`
honouring the same backoff as collection. A channel with nothing due gets no job.

## Worker

### Package `workers/python/src/topics/`

- `protocol.py` — `TopicItem(index, text, parent_text, is_reply)`,
  `TopicVerdict(status, topic_key, confidence, error_code)`, and the `TopicClassifier`
  protocol: `model_id`, `prompt_version`, `classify(taxonomy, items) -> list[TopicVerdict]`.
  A verdict naming a key not in the taxonomy is rewritten to `failed` with
  `gemini_bad_response`; the classifier never guesses. `TopicVerdict` enforces
  `(status == 'succeeded') == (topic_key is not None)` in `__post_init__`, as `Prediction`
  does.
- `gemini.py` — `GeminiTopicClassifier(api_key, client: httpx.Client, model_id='gemini-2.5-flash')`.
  One `generateContent` call per chunk of 25 items, `generationConfig` with
  `responseMimeType='application/json'`, `temperature=0`, and a `responseSchema` of
  `[{index: integer, topic_key: enum(taxonomy keys), confidence: number}]`. The prompt is a
  versioned constant (`PROMPT_VERSION = 'p1'`), lists each topic as `key — description`, and
  presents a reply as `رد على: <parent>` followed by the reply. 429 and 5xx are retried twice
  with backoff; after that every item in the chunk is `failed` with `gemini_rate_limited` or
  `gemini_unavailable`. A response that is not the schema, or omits an index, fails only the
  affected items with `gemini_bad_response`. No exception, log line or verdict carries the
  request URL, which holds the key.
- `deterministic.py` — `DeterministicTestClassifier`: hash-based, keyword-free, so tests are
  stable and its output never resembles real classification.
- `analysis.py` — `classify(classifier, taxonomy, key, rows) -> list[dict]` producing commit
  records `{external_comment_id, content_hash, classification_key, status, topic_key,
  confidence, model_id, prompt_version, error_code}`. Length mismatch raises, as
  `server/analysis.py` does. A row with `text is None` becomes `unsupported` without a call.

### Job handling

`server/runner.py` gains `run_topics(control, lease, classifier)`, dispatched when the claimed
job's `type == 'analyse'`. Loop: `topics_due` → classify → `commit_topics` (batch key = the
sorted external ids' hash) → heartbeat → repeat until the due list is empty. Finishes
`succeeded` when every chunk committed cleanly, `partial` with the first `gemini_*` code when
any item failed, `blocked` on `quota_exceeded`, and `skipped` with `no_topic_classifier` when
the worker has no classifier.

`server/gateway.py` gains `topics_due(lease, max_rows)` and `commit_topics(lease, batch_key,
records)`. `loop.py` builds a `GeminiTopicClassifier` when `GEMINI_API_KEY` is set and a
`DeterministicTestClassifier` under `--deterministic`; `.env.example` and
`workers/deploy/README.md` document the variable.

### Gateway

`supabase/functions/_shared/worker-gateway.ts` routes `/worker/topics-due` and
`/worker/commit-topics` to `svc_worker_topics_due` and `svc_worker_commit_topics` wrappers,
credential-hashed like every other route.

### Key restriction to verify first

The supplied key's console restriction reads "Agent Platform API". Implementation task 1 is a
single smoke call to `generativelanguage.googleapis.com` from the worker with that key,
recorded in `docs/verification.md`. If refused, the fix is enabling the Generative Language
API on the key in the console — the user's side — not a code change, and the rest of the work
proceeds fixture-tested until it is.

## Contracts

`packages/contracts/src`:

- `comments.ts`: `TopicSchema`, `TopicPredictionSchema`, `TopicReviewSchema`; `CommentSchema`
  gains `topic_prediction: TopicPredictionSchema.nullable().default(null)` and
  `topic_reviews: z.array(TopicReviewSchema).default([])`. `effectiveTopic(comment,
  activeTopicKey)` applies the same rule as `effectiveLabel`: newest human review on the
  current hash, else a succeeded prediction on the current hash under the active key, else
  null. `TopicReviewInputSchema` and `applyTopicReview` mirror the sentiment pair.
- `filters.ts`: `topics: z.array(z.string()).max(50).default([])`. The value
  `__unclassified` selects rows whose effective topic is null.
- `snapshot.ts`: `snapshot()` takes `activeTopicKey`; each `LabelledComment` carries `topic`
  and `topic_reviewed`; the output adds `topics` (taxonomy for the control) and
  `topic_counts` (`Record<key, number>` plus `unclassified`), computed over the same filtered
  rows as every other figure. `exportRows` carries the same fields.
- `csv.ts`: columns `effective_topic`, `topic_source` (`model|human_review|none`, the same
  vocabulary as `label_source`),
  `classification_key` after `analysis_key`. The key is exported, not the display name, so a
  rename never changes an old export's meaning.
- `fixture.ts`: fixture comments carry topic predictions across several keys and one topic
  review, so the demo shows the card as a live workspace will.

`apps/web/src/data.ts`: `submitTopicReview` beside `submitReview`, same optimistic-apply-then-
refetch path, same stale-hash handling.

## Dashboard

`Dashboard.tsx`, `report.css`, `strings/ar.ts`, `strings/en.ts`:

- The Topics card: a horizontal bar chart (Chart.js, one bar per non-retired topic with a
  count, sorted by count, colours from `chartTheme`), a "N not yet classified" line when
  `unclassified > 0`, and, when `active_topic_key` is null, a "no topic classification has
  run yet" state. The current placeholder text moves into that branch rather than being
  deleted: it is still the truth for a workspace with no classifier.
- A Topic multi-select in the filter bar beside sentiment, labelled per locale from
  `name_ar`/`name_en`, with "not yet classified" as an option.
- Each comment row shows its topic chip, marked when a human review wins.
- The correction form gains a topic mode: a `<select>` from the taxonomy plus reason,
  submitting `submitTopicReview`. The review-history list shows topic reviews beside
  sentiment reviews, each labelled with which dimension it corrected.
- Every new sentence lives in both string files.

Sync page: `analyse` jobs render as "Topic classification — <channel>"; the codes
`no_topic_classifier`, `gemini_rate_limited`, `gemini_unavailable`, `gemini_bad_response`
get human strings. `PlanCard` / `planWords.ts` show the third allowance.

## Error handling

| Situation | Outcome |
| --- | --- |
| No `GEMINI_API_KEY` on the worker | job `skipped`, `no_topic_classifier`; Sync page says a classifier is not configured |
| Gemini 429 / 5xx after retries | chunk items `failed` with `gemini_rate_limited` / `gemini_unavailable`; job `partial`; re-enqueued with backoff |
| Malformed JSON or a key not in the taxonomy | affected items `failed` with `gemini_bad_response`; the rest of the chunk stands |
| Text purged under retention | `unsupported`; never re-sent |
| Comment edited after classification | old verdict is history; the row is due again on the new hash |
| Taxonomy edited | `active_topic_key` resets; every row is due under the new version; old verdicts remain |
| Plan exhausted | job `blocked`; nothing charged for the refused batch |
| Worker lacks the `analyse` branch (old deploy) | the job stays queued; the tick does not duplicate it (dedupe key) |

## Testing

Real commands: `npm test`, `npm run test:db`, `npm run test:e2e`, `npm run worker:test`,
`npm run lint`, `npm run typecheck`.

- **Contracts (vitest):** `effectiveTopic` precedence and staleness on hash and key; the
  `topics` filter including `__unclassified`; `topic_counts` computed on the same filtered
  rows as the sentiment figures; CSV columns and formula-guarding on topic text; the fixture
  parses.
- **DB (`supabase/tests`):** constraints on `topic_predictions` and `topic_reviews`; first
  prediction sets `active_topic_key`; `set_workspace_topics` retires rather than deletes,
  bumps the version and resets the key; `submit_topic_review` refuses a stale hash, a retired
  topic and a non-member, by direct call; `worker_topics_due` returns only current-hash
  unclassified and `failed` rows for the leased channel, replies carry parent text, purged rows
  carry null text; `worker_commit_topics` is replay-safe by batch key and meters exactly once;
  `reserve_usage` refuses over the `topic_units` allowance; `schedule_due_work` enqueues one
  `analyse` job per channel with due rows and none otherwise; every new RPC refuses another
  workspace's ids.
- **Worker (pytest):** `GeminiTopicClassifier` through an injected fake client — request body
  shape, chunking at 25, retry on 429, `gemini_bad_response` on an unknown key, no URL in any
  raised message; `classify()` length mismatch and `unsupported` for null text; `run_topics`
  finishing `succeeded`, `partial`, `blocked` and `skipped`.
- **Browser (Playwright, append-only block in `dashboard.spec.ts`):** the Topics chart renders
  from the fixture; the topic filter narrows the KPIs, chart, table and CSV export together; a
  topic correction changes the chip and the chart; the no-classifier state reads as such.
- **Live, recorded in `docs/verification.md`:** the smoke call with the real key; one `analyse`
  job end-to-end against the deployed project. Everything else is labelled fixture-tested.

## Records

`docs/decisions.md` (Gemini as the topic layer; what is sent; the pinned model),
`docs/progress.md`, `docs/verification.md`, `.env.example`, `workers/deploy/README.md`, and
`docs/coordination/ACTIVE.md` claiming `workers/python/src/topics/**`, the migration, the two
gateway files, `packages/contracts/src/{comments,filters,snapshot,csv,fixture}.ts`,
`apps/web/src/{Dashboard.tsx,data.ts,PlanCard.tsx,planWords.ts,Sync.tsx,strings/**}` and the
append-only test block.

## Out of scope

The taxonomy-editing screen; secondary topics; classifying the channel owner's own replies
(they are excluded from every figure already); legacy `legacy_theme` import reconciliation,
which waits on the original files the input inventory lists as missing; per-video topic
comparison views beyond what the shared filter already gives.

[Dashboard.tsx:1240]: ../../../apps/web/src/Dashboard.tsx
