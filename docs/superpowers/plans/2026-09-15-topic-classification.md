# Topic Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every audience comment and reply gets one primary topic from a per-workspace taxonomy, decided by Gemini through the Python worker, stored with the sentiment layer's staleness discipline, shown and filterable on the dashboard, exported, correctable, and metered.

**Architecture:** Three migrations add the taxonomy, prediction and review tables, the metering kind, the worker RPCs and the tick rule, and rebuild the dashboard snapshot. The worker gains a `topics/` package (protocol, Gemini adapter, deterministic test adapter) and an `analyse` job branch that pulls due rows from the control plane, classifies them in chunks of 25, and commits them idempotently. The contracts package mirrors `effectiveLabel` as `effectiveTopic`, extends the filter contract, the snapshot, the CSV and the fixture; the dashboard replaces its "Not available yet" Topics card with a chart, a filter, a per-row chip and a correction mode.

**Tech Stack:** Postgres/PLpgSQL (Supabase migrations, PGlite tests via vitest), Deno edge function (TypeScript), Python 3.12 + httpx (pytest, ruff), Zod contracts (vitest), React 18 + Chart.js (Playwright), Gemini `generateContent` REST API.

**Spec:** `docs/superpowers/specs/2026-09-15-topic-classification-design.md`

## Global Constraints

- One writer on `main` in this checkout; there is no git remote. **Never `git checkout <path>` or `git reset --hard` a file with uncommitted work** (`docs/coordination/ACTIVE.md`). Commit after every task.
- Every UI sentence lives in `apps/web/src/strings/ar.ts` **and** `apps/web/src/strings/en.ts`; a key in one without the other fails `npm run typecheck`.
- No secret in source, in a `VITE_*` variable, in a log line, in an exception message, or in a request URL. The Gemini key travels only in the `x-goog-api-key` header. Locally it is `GEMINI_API_KEY` in the gitignored `.env.local` at the repo root.
- Gemini receives comment text, parent text and the taxonomy only — never author names, ids, or workspace identifiers.
- A verdict that could not be produced is `failed`/`skipped`/`unsupported`, never `other`.
- Only `succeeded` verdicts are metered; a comment is charged once ever under the key `topics:youtube:<external_comment_id>`.
- `tests/e2e/dashboard.spec.ts` is append-only: add a block at the end, never edit another's.
- Real commands: `npm test`, `npm run test:db`, `npm run worker:test`, `npm run worker:lint`, `npm run lint`, `npm run typecheck`, `npm run test:e2e`.
- Pinned model `gemini-2.5-flash`; prompt version `p1`. Classification key format: `topics:v<taxonomy_version>+<model_id>+<prompt_version>`.
- Job status vocabulary is fixed (`queued running succeeded partial failed blocked cancelled`). Where the spec says a job is "skipped" with `no_topic_classifier`, the job is finished **`blocked`** with that error code — the same idiom `channel_not_connected` uses.
- The spec's "one migration" is written as three files with consecutive timestamps (`160000`, `161000`, `162000`), which is how the selective-sync work split schema, worker RPCs and snapshot; each task's migration is testable on its own.

---

## File structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260915160000_a_comment_has_a_topic.sql` | Taxonomy, prediction and review tables; seeding; adoption trigger; metering kind; `submit_topic_review`; `set_workspace_topics` |
| `supabase/migrations/20260915161000_the_worker_classifies_topics.sql` | `topic_classification_key`, `topics_due`, `worker_topics_due`, `worker_commit_topics`, tick rule, `svc_` wrappers |
| `supabase/migrations/20260915162000_the_dashboard_reads_topics.sql` | `dashboard_snapshot_impl` rebuilt with topics |
| `supabase/tests/topics.test.ts` | Schema, seeding, adoption, review, taxonomy edit, metering |
| `supabase/tests/worker_topics.test.ts` | Due list, commit, replay, quota, tick |
| `supabase/tests/dashboard_topics.test.ts` | Snapshot carries topics |
| `packages/contracts/src/topics.ts` | `TopicSchema`, `TopicPredictionSchema`, `TopicReviewSchema`, `TopicReviewInputSchema`, `effectiveTopic`, `applyTopicReview`, `UNCLASSIFIED` |
| `packages/contracts/src/topics.test.ts` | Precedence and staleness |
| `packages/contracts/src/{comments,filters,snapshot,csv,fixture,usage}.ts` | Extended in place |
| `apps/web/public/fixtures/dashboard.json` | Carries topics |
| `workers/python/src/topics/{__init__,protocol,deterministic,analysis,gemini}.py` | Classifier protocol, test adapter, record builder, Gemini adapter |
| `workers/python/tests/{test_topics,test_gemini,test_run_topics}.py` | Worker tests |
| `workers/python/src/server/{gateway,runner,loop}.py` | `topics_due`, `commit_topics`, `run_topics`, wiring |
| `supabase/functions/_shared/worker-gateway.ts`, `supabase/functions/worker/index.ts` | Two routes |
| `apps/web/src/{data,Dashboard,jobFeed,OperationsPanels,planWords}.ts(x)`, `strings/{ar,en}.ts`, `report.css` | Dashboard integration |
| `tests/e2e/dashboard.spec.ts` | Appended block |
| `docs/{decisions,progress,verification}.md`, `docs/coordination/ACTIVE.md`, `.env.example`, `workers/deploy/README.md` | Records |

---

### Task 1: Prove the key reaches Gemini

**Files:**
- Create: `workers/python/scripts/gemini_smoke.py`
- Modify: `docs/verification.md` (append)

**Interfaces:**
- Produces: nothing code depends on. The answer decides whether Task 7's live check can run; every other task is fixture-tested regardless.

- [ ] **Step 1: Write the smoke script**

```python
"""One request to Gemini with the configured key. Prints the HTTP status and
whether the JSON schema constraint was honoured; never prints the key or the URL."""
import json
import os
import sys

import httpx

MODEL = "gemini-2.5-flash"
BODY = {
    "contents": [{"role": "user", "parts": [{"text":
        "صنّف هذا التعليق إلى موضوع واحد من: question, praise, other.\n"
        "التعليق: ما اسم الأغنية في المقدمة؟\n"
        "أجب بصيغة JSON فقط."}]}],
    "generationConfig": {
        "temperature": 0,
        "responseMimeType": "application/json",
        "responseSchema": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "index": {"type": "INTEGER"},
                    "topic_key": {"type": "STRING", "enum": ["question", "praise", "other"]},
                    "confidence": {"type": "NUMBER"},
                },
                "required": ["index", "topic_key", "confidence"],
            },
        },
    },
}


def main() -> int:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        print("GEMINI_API_KEY is not set")
        return 2
    r = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        headers={"x-goog-api-key": key, "content-type": "application/json"},
        json=BODY,
        timeout=30,
    )
    print("status", r.status_code)
    if r.status_code != 200:
        # The error body names the restriction; it does not carry the key.
        print(json.dumps(r.json().get("error", {}), ensure_ascii=False)[:600])
        return 1
    text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    parsed = json.loads(text)
    print("schema honoured:", isinstance(parsed, list) and "topic_key" in parsed[0])
    print("verdict:", parsed[0])
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run it with the local key**

Run:
```bash
set -a; source .env.local; set +a; uv --directory workers/python --cache-dir ../../.cache/uv run --frozen python scripts/gemini_smoke.py
```
Expected, if the key's restriction admits the Generative Language API: `status 200`, `schema honoured: True`, and a verdict of `{"index": 0, "topic_key": "question", "confidence": ...}`.
Expected, if the restriction refuses it: `status 403` and an error whose `reason` names the API restriction (`API_KEY_SERVICE_BLOCKED` or similar). Do not change code for this; it is the console setting the spec names.

- [ ] **Step 3: Record the outcome**

Append to `docs/verification.md` under a `## 2026-09-15 — topic classification` heading: the status, whether the schema was honoured, and — if refused — the exact `reason` string and that the fix is enabling the Generative Language API on the key's restrictions in the Google Cloud console. Live-tested, dated.

- [ ] **Step 4: Commit**

```bash
git add workers/python/scripts/gemini_smoke.py docs/verification.md
git commit -m "A smoke call proves whether the Gemini key reaches the model at all"
```

---

### Task 2: Schema — taxonomy, predictions, reviews, metering

**Files:**
- Create: `supabase/migrations/20260915160000_a_comment_has_a_topic.sql`
- Test: `supabase/tests/topics.test.ts`

**Interfaces:**
- Produces: tables `public.workspace_topics`, `public.topic_predictions`, `public.topic_reviews`; columns `public.workspaces.topic_taxonomy_version`, `public.workspaces.active_topic_key`, `public.plans.topic_units`; usage event type `topic_classification`; functions `private.seed_default_topics(uuid)`, `public.submit_topic_review(w uuid, c uuid, seen_hash text, topic text, why text) returns uuid`, `public.set_workspace_topics(w uuid, topics jsonb) returns int`; `private.reserve_usage` accepting `'topic_classification'`; `usage_summary` returning a third budget.

- [ ] **Step 1: Write the failing test**

`supabase/tests/topics.test.ts`:

```ts
/**
 * A comment has a topic, stored under the sentiment layer's rules.
 *
 * The taxonomy is per workspace and seeded; a prediction is keyed on the text
 * it judged and the key it was produced under; a review is append-only and
 * names its reviewer; the first successful classification becomes the active
 * one and a taxonomy edit unseats it.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const OWNER = "10000000-0000-4000-8000-000000000001";
const STRANGER = "10000000-0000-4000-8000-000000000002";
const C1 = "aaaaaaaa-0000-4000-8000-000000000001";
const C2 = "aaaaaaaa-0000-4000-8000-000000000002";
const KEY = "topics:v1+gemini-2.5-flash+p1";
let db: PGlite;

const as = async (id: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
};
const admin = () => db.exec("reset role");
const scalar = async <T,>(sql: string, params: unknown[] = []) =>
  (await db.query<{ v: T }>(sql, params)).rows[0].v;

const predict = (
  comment: string,
  hash: string,
  key: string,
  status = "succeeded",
  topic: string | null = "praise",
) =>
  db.query(
    `insert into topic_predictions(workspace_id,comment_id,content_hash,classification_key,
       status,topic_key,confidence,model_id,prompt_version)
     values ($1,$2,$3,$4,$5,$6,0.9,'gemini-2.5-flash','p1')`,
    [W, comment, hash, key, status, topic],
  );

describe("a comment has a topic", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const f of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await admin();
    for (const u of [OWNER, STRANGER])
      await db.query("insert into auth.users(id) values ($1)", [u]);
    for (const [w, u] of [
      [W, OWNER],
      [OTHER, STRANGER],
    ]) {
      await db.query(
        "insert into workspaces(id,name,created_by) values ($1,'w',$2)",
        [w, u],
      );
      await db.query("insert into memberships values ($1,$2,'workspace_owner')", [w, u]);
      await db.query("insert into clients(id,workspace_id,name) values ($1,$1,'c')", [w]);
      await db.query(
        `insert into channels(id,workspace_id,client_id,external_channel_id,status)
         values ($1,$1,$1,$2,'connected')`,
        [w, `UC${w.slice(-1).repeat(22)}`],
      );
      await db.query(
        `insert into videos(id,workspace_id,channel_id,external_video_id,title,kind)
         values ($1,$1,$1,'vid','حلقة','video')`,
        [w],
      );
    }
    for (const [id, ext] of [
      [C1, "c1"],
      [C2, "c2"],
    ])
      await db.query(
        `insert into comments(id,workspace_id,video_id,external_comment_id,text_raw,text_plain,
          content_hash,timestamp_precision,source,author_name,published_at)
         values ($1,$2,$2,$3,'نص','نص','h1','second','youtube_oauth','مؤلف',now())`,
        [id, W, ext],
      );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("seeds ten topics into every workspace, existing or new", async () => {
    await admin();
    expect(await scalar<number>("select count(*)::int as v from workspace_topics where workspace_id=$1", [W])).toBe(10);
    const keys = await db.query<{ key: string }>(
      "select key from workspace_topics where workspace_id=$1 order by position",
      [W],
    );
    expect(keys.rows.map((r) => r.key)).toEqual([
      "question", "religious", "praise", "criticism", "request",
      "discussion", "personal", "humour", "promotion", "other",
    ]);
    expect(await scalar<number>("select topic_taxonomy_version as v from workspaces where id=$1", [W])).toBe(1);
  });

  it("refuses a succeeded prediction without a topic and a topic without success", async () => {
    await admin();
    await expect(predict(C1, "h1", KEY, "succeeded", null)).rejects.toThrow();
    await expect(predict(C1, "h1", KEY, "failed", "praise")).rejects.toThrow();
    await expect(predict(C1, "h1", KEY, "succeeded", "not_a_topic")).rejects.toThrow();
  });

  it("adopts the first successful classification as the workspace's active key", async () => {
    await admin();
    expect(await scalar<string | null>("select active_topic_key as v from workspaces where id=$1", [W])).toBeNull();
    await predict(C1, "h0", KEY, "failed", null); // a failure adopts nothing
    expect(await scalar<string | null>("select active_topic_key as v from workspaces where id=$1", [W])).toBeNull();
    await predict(C1, "h1", KEY);
    expect(await scalar<string | null>("select active_topic_key as v from workspaces where id=$1", [W])).toBe(KEY);
    await predict(C2, "h1", "topics:v1+other-model+p1");
    // Later analyses do not take over silently.
    expect(await scalar<string | null>("select active_topic_key as v from workspaces where id=$1", [W])).toBe(KEY);
  });

  it("stores one verdict per comment, text and key", async () => {
    await admin();
    await expect(predict(C1, "h1", KEY)).rejects.toThrow();
    await predict(C1, "h2", KEY); // an edited text is a new verdict
  });

  it("lets a member correct a topic with a reason, on the text they read", async () => {
    await as(OWNER);
    const id = await scalar<string>(
      "select submit_topic_review($1,$2,'h1','request','هذا طلب لا مدح') as v",
      [W, C1],
    );
    expect(id).toMatch(/[0-9a-f-]{36}/);
    await expect(
      db.query("select submit_topic_review($1,$2,'stale','request','x')", [W, C1]),
    ).rejects.toThrow(/stale_comment_text/);
    await expect(
      db.query("select submit_topic_review($1,$2,'h1','not_a_topic','x')", [W, C1]),
    ).rejects.toThrow(/invalid_topic/);
    await expect(
      db.query("select submit_topic_review($1,$2,'h1','request','')", [W, C1]),
    ).rejects.toThrow(/invalid_reason/);
    await admin();
    const row = await db.query<{ reviewer_id: string; origin: string }>(
      "select reviewer_id, origin from topic_reviews where comment_id=$1",
      [C1],
    );
    expect(row.rows[0]).toEqual({ reviewer_id: OWNER, origin: "human" });
  });

  it("is append-only and refuses a stranger by direct call", async () => {
    await admin();
    await expect(db.query("delete from topic_reviews")).rejects.toThrow(/append_only/);
    await as(STRANGER);
    await expect(
      db.query("select submit_topic_review($1,$2,'h1','request','x')", [W, C1]),
    ).rejects.toThrow(/forbidden/);
    expect(await scalar<number>("select count(*)::int as v from topic_predictions")).toBe(0);
    expect(await scalar<number>("select count(*)::int as v from workspace_topics where workspace_id=$1", [W])).toBe(0);
  });

  it("retires rather than deletes on a taxonomy edit, bumps the version and unseats the key", async () => {
    await as(OWNER);
    const version = await scalar<number>(
      `select set_workspace_topics($1, $2::jsonb) as v`,
      [W, JSON.stringify([
        { key: "question", name_ar: "أسئلة", name_en: "Questions", description: "Asks something." },
        { key: "praise", name_ar: "إشادة", name_en: "Praise", description: "Compliments." },
        { key: "shipping", name_ar: "الشحن", name_en: "Shipping", description: "Delivery questions." },
      ])],
    );
    expect(version).toBe(2);
    await admin();
    expect(await scalar<number>("select count(*)::int as v from workspace_topics where workspace_id=$1 and retired_at is null", [W])).toBe(3);
    expect(await scalar<number>("select count(*)::int as v from workspace_topics where workspace_id=$1 and retired_at is not null", [W])).toBe(8);
    expect(await scalar<string | null>("select active_topic_key as v from workspaces where id=$1", [W])).toBeNull();
    // Old verdicts remain: history, not deleted.
    expect(await scalar<number>("select count(*)::int as v from topic_predictions where workspace_id=$1", [W])).toBe(4);
    await as(STRANGER);
    await expect(db.query("select set_workspace_topics($1,'[]'::jsonb)", [W])).rejects.toThrow(/forbidden/);
  });

  it("meters topic classification as its own kind against its own allowance", async () => {
    await admin();
    await db.query(
      "insert into plans(key,analysis_units,backfill_units,topic_units) values ('t',100,0,2)",
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'t','active',now()-interval '1 day',now()+interval '29 days')`,
      [W],
    );
    await db.exec("set role service_role");
    const granted = await scalar<string[]>(
      "select private.reserve_usage($1,'topic_classification',array['topics:youtube:a','topics:youtube:b','topics:youtube:c']) as v",
      [W],
    );
    expect(granted).toEqual(["topics:youtube:a", "topics:youtube:b"]);
    await admin();
    await as(OWNER);
    const summary = await scalar<{ budgets: { event_type: string; used: number; allowance: number }[] }>(
      "select usage_summary($1) as v",
      [W],
    );
    expect(summary.budgets.map((b) => b.event_type)).toEqual([
      "comment_analysis", "historical_backfill", "topic_classification",
    ]);
    expect(summary.budgets[2]).toMatchObject({ used: 2, allowance: 2 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run supabase/tests/topics.test.ts`
Expected: FAIL — `relation "workspace_topics" does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260915160000_a_comment_has_a_topic.sql`:

```sql
-- A comment has a topic. Until now the dashboard's Topics card said "not
-- available yet" and meant it: nothing in the schema could hold what a
-- comment is about. This adds that dimension beside sentiment, under the same
-- rules — a verdict is about one text (its hash) under one key, the first
-- success becomes the workspace's active classification, and a human
-- correction is append-only and names who made it.
--
-- Design: docs/superpowers/specs/2026-09-15-topic-classification-design.md

-- ---------------------------------------------------------------- taxonomy
create table public.workspace_topics (
  workspace_id uuid not null references public.workspaces(id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  name_ar text not null check (length(name_ar) between 1 and 80),
  name_en text not null check (length(name_en) between 1 and 80),
  -- What the prompt tells the model. Part of the taxonomy on purpose: two
  -- workspaces with the same keys and different descriptions ask different
  -- questions.
  description text not null check (length(description) between 1 and 400),
  position int not null,
  retired_at timestamptz null,
  primary key (workspace_id, key)
);

alter table public.workspaces
  add column topic_taxonomy_version int not null default 1,
  -- Set by the first successful classification, cleared by a taxonomy edit.
  -- On the workspace rather than the channel because the taxonomy is.
  add column active_topic_key text null;

create function private.seed_default_topics(w uuid) returns void
language sql security definer set search_path='' as $$
  insert into public.workspace_topics(workspace_id, key, name_ar, name_en, description, position)
  values
    (w, 'question',   'استفسارات وأسئلة',           'Questions & inquiries',
        'Asks the creator or others something, or requests information.', 1),
    (w, 'religious',  'دعاء وذكر وتعبير ديني',      'Prayers & religious remarks',
        'Prayer, supplication, remembrance of God, religious phrasing as the main content.', 2),
    (w, 'praise',     'إشادة ودعم',                 'Praise & support',
        'Compliments, thanks, encouragement toward the creator or content.', 3),
    (w, 'criticism',  'نقد واعتراض',                'Criticism & objection',
        'Disagreement, complaint, or negative judgement of the content, creator or subject.', 4),
    (w, 'request',    'طلبات واقتراحات',            'Requests & suggestions',
        'Asks for future content, features, changes, or makes a suggestion.', 5),
    (w, 'discussion', 'نقاش وتحليل الموضوع',        'Discussion of the subject',
        'Substantive commentary on the topic of the video itself.', 6),
    (w, 'personal',   'تجارب وقصص شخصية',           'Personal stories & experiences',
        'Shares the commenter''s own situation or experience.', 7),
    (w, 'humour',     'مزاح ودعابة',                'Humour & banter',
        'Jokes, memes, playful remarks.', 8),
    (w, 'promotion',  'ترويج ومحتوى دعائي',         'Promotion & spam',
        'Advertising, self-promotion, links, repeated off-purpose content.', 9),
    (w, 'other',      'خارج الموضوع / أخرى',        'Off-topic / other',
        'Does not fit the above or is unrelated to the video.', 10)
  on conflict (workspace_id, key) do nothing;
$$;

create function private.seed_topics_for_new_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.seed_default_topics(new.id);
  return new;
end $$;
create trigger seed_topics after insert on public.workspaces
  for each row execute function private.seed_topics_for_new_workspace();

-- Every workspace that already exists gets the same ten.
do $$ declare w uuid; begin
  for w in select id from public.workspaces loop
    perform private.seed_default_topics(w);
  end loop;
end $$;

-- ------------------------------------------------------------- predictions
create table public.topic_predictions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  comment_id uuid not null,
  -- The exact text judged. An edit changes the hash and this verdict becomes
  -- history rather than being applied to text no model saw.
  content_hash text not null,
  -- topics:v<taxonomy_version>+<model_id>+<prompt_version>. A taxonomy edit,
  -- a model change or a prompt change is a new key, never a silent relabel.
  classification_key text not null,
  status text not null check (status in ('succeeded','skipped','failed','unsupported')),
  topic_key text null,
  confidence numeric(4,3) null check (confidence is null or confidence between 0 and 1),
  model_id text not null,
  prompt_version text not null,
  error_code text null,
  predicted_at timestamptz not null default now(),
  check ((status = 'succeeded') = (topic_key is not null)),
  unique (workspace_id, comment_id, content_hash, classification_key),
  foreign key (workspace_id, comment_id) references public.comments (workspace_id, id),
  foreign key (workspace_id, topic_key) references public.workspace_topics (workspace_id, key)
);
create index topic_predictions_by_comment
  on public.topic_predictions(workspace_id, comment_id, content_hash, classification_key);

-- Adopted on first success only, as 20260914030000 does for sentiment: a
-- workspace with no active classification takes the one that just ran; one
-- that has must not have it swapped underneath it.
create function private.adopt_first_topic_classification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.workspaces w
     set active_topic_key = k.classification_key
    from (
      select n.workspace_id, min(n.classification_key) as classification_key
        from new_predictions n
       where n.status = 'succeeded'
       group by n.workspace_id
      having count(distinct n.classification_key) = 1
    ) k
   where w.id = k.workspace_id
     and w.active_topic_key is null;
  return null;
end $$;
revoke all on function private.adopt_first_topic_classification() from public, anon, authenticated;
create trigger adopt_first_topic_classification
  after insert on public.topic_predictions
  referencing new table as new_predictions
  for each statement execute function private.adopt_first_topic_classification();

-- ----------------------------------------------------------------- reviews
create table public.topic_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  comment_id uuid not null,
  content_hash text not null,
  topic_key text not null,
  reviewer_id uuid not null references auth.users(id),
  reason text not null check (length(trim(reason)) between 1 and 500),
  origin text not null default 'human' check (origin in ('human')),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, comment_id) references public.comments (workspace_id, id),
  foreign key (workspace_id, topic_key) references public.workspace_topics (workspace_id, key)
);
create trigger topic_reviews_append_only before update or delete on public.topic_reviews
  for each row execute function private.reject_review_mutation();

-- Tenant read, no tenant write, service role everything — the catalogue
-- tables' pattern.
do $$ declare t text; begin
  foreach t in array array['workspace_topics','topic_predictions','topic_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy tenant_read on public.%I for select to authenticated using (private.has_role(workspace_id))', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Reviews are written only through this, so the reviewer and the provenance
-- come from the session, as submit_comment_review does.
create function private.submit_topic_review_impl(w uuid, c uuid, seen_hash text, topic text, why text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid; current_hash text; begin
  if not private.has_role(w, array['workspace_owner','analyst']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (select 1 from public.workspace_topics t
                  where t.workspace_id=w and t.key=topic and t.retired_at is null) then
    raise exception 'invalid_topic' using errcode='22023'; end if;
  if why is null or length(trim(why)) not between 1 and 500 then
    raise exception 'invalid_reason' using errcode='22023'; end if;
  select content_hash into current_hash from public.comments where workspace_id=w and id=c;
  if current_hash is null then raise exception 'invalid_comment' using errcode='23503'; end if;
  if current_hash is distinct from seen_hash then
    raise exception 'stale_comment_text' using errcode='40001'; end if;
  insert into public.topic_reviews(workspace_id,comment_id,content_hash,topic_key,reviewer_id,reason,origin)
  values (w, c, current_hash, topic, (select auth.uid()), trim(why), 'human') returning id into r;
  return r;
end $$;
create function public.submit_topic_review(w uuid, c uuid, seen_hash text, topic text, why text)
returns uuid language sql security invoker set search_path='' as $$
  select private.submit_topic_review_impl(w, c, seen_hash, topic, why) $$;

-- Replaces the active set. Rows absent from the payload are retired, not
-- deleted — predictions reference them. The version moves and the active key
-- is cleared, so every row is due again under the new taxonomy and nothing
-- classified under the old one is shown as if it were.
create function private.set_workspace_topics_impl(w uuid, topics jsonb) returns int
language plpgsql security definer set search_path='' as $$
declare v int; begin
  if not private.has_role(w, array['workspace_owner']) then
    raise exception 'forbidden' using errcode='42501'; end if;
  if topics is null or jsonb_typeof(topics) <> 'array' or jsonb_array_length(topics) = 0
     or jsonb_array_length(topics) > 50 then
    raise exception 'invalid_topics' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(topics) t
              where jsonb_typeof(t) <> 'object'
                 or coalesce(t->>'key','') !~ '^[a-z][a-z0-9_]{0,39}$'
                 or length(coalesce(t->>'name_ar','')) not between 1 and 80
                 or length(coalesce(t->>'name_en','')) not between 1 and 80
                 or length(coalesce(t->>'description','')) not between 1 and 400) then
    raise exception 'invalid_topics' using errcode='22023'; end if;
  if (select count(distinct t->>'key') from jsonb_array_elements(topics) t)
     <> jsonb_array_length(topics) then
    raise exception 'invalid_topics' using errcode='22023'; end if;

  insert into public.workspace_topics(workspace_id, key, name_ar, name_en, description, position)
  select w, t->>'key', t->>'name_ar', t->>'name_en', t->>'description', ord
    from jsonb_array_elements(topics) with ordinality as x(t, ord)
  on conflict (workspace_id, key) do update set
    name_ar = excluded.name_ar, name_en = excluded.name_en,
    description = excluded.description, position = excluded.position,
    retired_at = null;
  update public.workspace_topics set retired_at = now()
   where workspace_id = w and retired_at is null
     and key not in (select t->>'key' from jsonb_array_elements(topics) t);

  update public.workspaces
     set topic_taxonomy_version = topic_taxonomy_version + 1, active_topic_key = null
   where id = w returning topic_taxonomy_version into v;
  return v;
end $$;
create function public.set_workspace_topics(w uuid, topics jsonb) returns int
language sql security invoker set search_path='' as $$
  select private.set_workspace_topics_impl(w, topics) $$;

revoke all on function
  private.seed_default_topics(uuid), private.seed_topics_for_new_workspace(),
  private.submit_topic_review_impl(uuid,uuid,text,text,text), private.set_workspace_topics_impl(uuid,jsonb),
  public.submit_topic_review(uuid,uuid,text,text,text), public.set_workspace_topics(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function
  private.submit_topic_review_impl(uuid,uuid,text,text,text), private.set_workspace_topics_impl(uuid,jsonb),
  public.submit_topic_review(uuid,uuid,text,text,text), public.set_workspace_topics(uuid,jsonb)
  to authenticated;
grant execute on function
  private.seed_default_topics(uuid), private.seed_topics_for_new_workspace()
  to service_role;

-- ---------------------------------------------------------------- metering
alter table public.usage_events drop constraint usage_events_event_type_check;
alter table public.usage_events add constraint usage_events_event_type_check
  check (event_type in ('comment_analysis','historical_backfill','topic_classification'));
alter table public.plans add column topic_units integer not null default 0 check (topic_units >= 0);
update public.plans set topic_units = 5000 where key = 'pilot';

-- reserve_usage, rebuilt from the foundation with one change: a third kind
-- drawing on its own allowance.
create or replace function private.reserve_usage(w uuid,kind text,keys text[]) returns text[]
language plpgsql security invoker set search_path='' as $$
declare sub record; allowance int; used int; covered text[]; fresh text[]; begin
 if kind not in ('comment_analysis','historical_backfill','topic_classification') then
   raise exception 'invalid_event_type' using errcode='22023'; end if;
 if coalesce(array_length(keys,1),0) > 500 then raise exception 'batch_too_large' using errcode='22023'; end if;
 select s.status,s.period_start,s.period_end,pl.analysis_units,pl.backfill_units,pl.topic_units into sub
 from public.subscriptions s join public.plans pl on pl.key=s.plan_key
 where s.workspace_id=w for update of s;
 if not found then raise exception 'no_active_plan' using errcode='42501'; end if;
 if sub.status<>'active' or now()<sub.period_start or now()>=sub.period_end then
 raise exception 'plan_inactive' using errcode='42501'; end if;
 allowance := case kind when 'comment_analysis' then sub.analysis_units
                        when 'historical_backfill' then sub.backfill_units
                        else sub.topic_units end;
 select coalesce(array_agg(u.event_key),'{}') into covered
 from public.usage_events u where u.workspace_id=w and u.event_key=any(keys);
 used := private.used_units(w,kind,sub.period_start);
 select coalesce(array_agg(distinct k),'{}') into fresh from unnest(keys) as k where not (k=any(covered));
 fresh := fresh[1:greatest(allowance-used,0)];
 insert into public.usage_events(workspace_id,period_start,event_key,event_type)
 select w,sub.period_start,k,kind from unnest(fresh) as k;
 return covered||fresh;
end $$;

-- usage_summary_impl, rebuilt from the foundation with one addition: the
-- third budget line.
create or replace function private.usage_summary_impl(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sub record; begin
 if not private.has_role(w) then raise exception 'forbidden' using errcode='42501'; end if;
 select s.plan_key,s.status,s.period_start,s.period_end,pl.analysis_units,pl.backfill_units,pl.topic_units into sub
 from public.subscriptions s join public.plans pl on pl.key=s.plan_key where s.workspace_id=w;
 if not found then return null; end if;
 return jsonb_build_object(
 'plan_key',sub.plan_key,'status',sub.status,
 'period_start',to_jsonb(sub.period_start),'period_end',to_jsonb(sub.period_end),
 'budgets',jsonb_build_array(
 private.budget_entry('comment_analysis',sub.analysis_units,private.used_units(w,'comment_analysis',sub.period_start)),
 private.budget_entry('historical_backfill',sub.backfill_units,private.used_units(w,'historical_backfill',sub.period_start)),
 private.budget_entry('topic_classification',sub.topic_units,private.used_units(w,'topic_classification',sub.period_start))));
end $$;
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run supabase/tests/topics.test.ts`
Expected: PASS, all eight.

- [ ] **Step 5: Run the whole DB suite — nothing else may move**

Run: `npm run test:db`
Expected: PASS. If `usage_summary` assertions elsewhere expect exactly two budgets, that test is stating a fact that has changed; update the expectation there to three and say so in the commit.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260915160000_a_comment_has_a_topic.sql supabase/tests/topics.test.ts
git commit -m "A comment has a topic: taxonomy, predictions, reviews and a metered kind"
```

---

### Task 3: Worker RPCs — due list, commit, and the tick rule

**Files:**
- Create: `supabase/migrations/20260915161000_the_worker_classifies_topics.sql`
- Test: `supabase/tests/worker_topics.test.ts`

**Interfaces:**
- Consumes: Task 2's tables and `private.reserve_usage(w,'topic_classification',keys)`.
- Produces:
  - `private.topic_classification_key(w uuid, model_id text, prompt_version text) returns text`
  - `private.topics_pending(w uuid, c uuid) returns boolean` — used by the tick
  - `private.worker_topics_due(token_hash text, j uuid, t uuid, model_id text, prompt_version text, max_rows int) returns jsonb` → `{classification_key, active: boolean, taxonomy: [{key, description}], rows: [{external_comment_id, content_hash, text, parent_text, is_reply}]}`
  - `private.worker_commit_topics(token_hash text, j uuid, t uuid, b text, records jsonb) returns jsonb` → `{replayed: boolean, stored: int}`
  - `public.svc_worker_topics_due(credential_hash text, j uuid, t uuid, model_id text, prompt_version text, max_rows int)` and `public.svc_worker_commit_topics(credential_hash text, j uuid, t uuid, b text, records jsonb)`
  - `private.schedule_due_work` enqueuing `analyse` jobs.
  - Record shape accepted by commit: `{external_comment_id, content_hash, classification_key, status, topic_key, confidence, model_id, prompt_version, error_code}`.

- [ ] **Step 1: Write the failing test**

`supabase/tests/worker_topics.test.ts`:

```ts
/**
 * The worker classifies topics through the control plane: it is handed the
 * rows that lack a verdict under the key its model produces, and commits
 * verdicts idempotently and metered.
 */
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000001";
const CRED = "worker-credential";
const HASH = createHash("sha256").update(CRED).digest("hex");
const MODEL = "gemini-2.5-flash";
const KEY = "topics:v1+gemini-2.5-flash+p1";
let db: PGlite;
let job: { id: string; lease_token: string };

const scalar = async <T,>(sql: string, params: unknown[] = []) =>
  (await db.query<{ v: T }>(sql, params)).rows[0].v;
const admin = () => db.exec("reset role");
const service = () => db.exec("set role service_role");

const due = (max = 200) =>
  scalar<{
    classification_key: string;
    active: boolean;
    taxonomy: { key: string; description: string }[];
    rows: { external_comment_id: string; content_hash: string; text: string | null; parent_text: string | null; is_reply: boolean }[];
  }>(
    "select private.worker_topics_due($1,$2,$3,$4,'p1',$5) as v",
    [HASH, job.id, job.lease_token, MODEL, max],
  );
const record = (id: string, over: Record<string, unknown> = {}) => ({
  external_comment_id: id,
  content_hash: `h-${id}`,
  classification_key: KEY,
  status: "succeeded",
  topic_key: "praise",
  confidence: 0.91,
  model_id: MODEL,
  prompt_version: "p1",
  error_code: null,
  ...over,
});
const commit = (key: string, records: unknown[]) =>
  scalar<{ replayed: boolean; stored: number }>(
    "select private.worker_commit_topics($1,$2,$3,$4,$5::jsonb) as v",
    [HASH, job.id, job.lease_token, key, JSON.stringify(records)],
  );

describe("the worker classifies topics", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const f of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await admin();
    await db.query("insert into auth.users(id) values ($1)", [OWNER]);
    await db.query("insert into workspaces(id,name,created_by) values ($1,'w',$2)", [W, OWNER]);
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [W, OWNER]);
    await db.query("insert into clients(id,workspace_id,name) values ($1,$1,'c')", [W]);
    await db.query(
      `insert into channels(id,workspace_id,client_id,external_channel_id,status)
       values ($1,$1,$1,$2,'connected')`,
      [W, `UC${"a".repeat(22)}`],
    );
    await db.query(
      `insert into videos(id,workspace_id,channel_id,external_video_id,title,kind)
       values ($1,$1,$1,'vid','حلقة','video')`,
      [W],
    );
    // c1 top-level, c2 a reply to c1, c3 purged, c4 the channel's own voice.
    for (const [ext, parent, reply, text, author] of [
      ["c1", null, false, "ما اسم الأغنية؟", "UCviewer"],
      ["c2", "c1", true, "آمين", "UCviewer2"],
      ["c3", null, false, null, "UCviewer3"],
      ["c4", null, false, "شكرا للمتابعة", `UC${"a".repeat(22)}`],
    ] as const)
      await db.query(
        `insert into comments(workspace_id,video_id,external_comment_id,external_parent_id,is_reply,
           text_raw,text_plain,content_hash,timestamp_precision,source,author_channel_id,author_name,
           published_at,content_purged_at)
         values ($1,$1,$2,$3,$4,$5,$5,$6,'second','youtube_oauth',$7,'مؤلف',now(),
                 case when $5::text is null then now() else null end)`,
        [W, ext, parent, reply, text, `h-${ext}`, author],
      );
    await db.query("insert into plans(key,analysis_units,backfill_units,topic_units) values ('t',100,0,3)");
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'t','active',now()-interval '1 day',now()+interval '29 days')`,
      [W],
    );
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'w',$2)",
      [HASH, W],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("the tick enqueues one analyse job for a channel with unclassified comments", async () => {
    await service();
    const first = await scalar<{ analyse: number }>("select private.schedule_due_work($1) as v", [W]);
    expect(first.analyse).toBe(1);
    const again = await scalar<{ analyse: number }>("select private.schedule_due_work($1) as v", [W]);
    expect(again.analyse).toBe(0); // one outstanding per channel
    const claimed = await db.query<{ id: string; lease_token: string; type: string }>(
      "select id, lease_token, type from private.claim_job($1)",
      [W],
    );
    expect(claimed.rows[0].type).toBe("analyse");
    job = claimed.rows[0];
  });

  it("hands over the rows lacking a verdict, with parent text and the taxonomy", async () => {
    await service();
    const list = await due();
    expect(list.classification_key).toBe(KEY);
    expect(list.active).toBe(true); // no active key yet: this one may be adopted
    expect(list.taxonomy.map((t) => t.key)).toContain("question");
    expect(list.taxonomy[0]).not.toHaveProperty("name_ar"); // the prompt needs key + description only
    const byId = Object.fromEntries(list.rows.map((r) => [r.external_comment_id, r]));
    expect(Object.keys(byId).sort()).toEqual(["c1", "c2", "c3"]); // c4 is the channel's own voice
    expect(byId.c2).toMatchObject({ is_reply: true, parent_text: "ما اسم الأغنية؟" });
    expect(byId.c3.text).toBeNull(); // purged: returned so the worker records it unsupported
    expect((await due(1)).rows).toHaveLength(1);
    // Nothing identifying travels: no author, no ids beyond the external one.
    expect(byId.c1).not.toHaveProperty("author_name");
  });

  it("commits verdicts once, meters only successes, and replays a batch as a no-op", async () => {
    await service();
    const first = await commit("b1", [
      record("c1", { topic_key: "question" }),
      record("c2", { topic_key: "religious" }),
      record("c3", { status: "unsupported", topic_key: null, confidence: null, error_code: "text_purged" }),
    ]);
    expect(first).toEqual({ replayed: false, stored: 3 });
    expect(await scalar<number>("select count(*)::int as v from usage_events where event_type='topic_classification'")).toBe(2);
    const replay = await commit("b1", [
      record("c1", { topic_key: "question" }),
      record("c2", { topic_key: "religious" }),
      record("c3", { status: "unsupported", topic_key: null, confidence: null, error_code: "text_purged" }),
    ]);
    expect(replay).toEqual({ replayed: true, stored: 0 });
    expect(await scalar<number>("select count(*)::int as v from topic_predictions")).toBe(3);
    await expect(commit("b1", [record("c1")])).rejects.toThrow(/batch_conflict/);
    // The first success adopted the key, and nothing is due any more.
    expect(await scalar<string>("select active_topic_key as v from workspaces where id=$1", [W])).toBe(KEY);
    expect((await due()).rows).toEqual([]);
    expect(await scalar<boolean>("select private.topics_pending($1,$1) as v", [W])).toBe(false);
  });

  it("refuses a verdict on a topic not in the taxonomy, a key it did not assign, and a comment it does not hold", async () => {
    await service();
    await expect(commit("b2", [record("c1", { content_hash: "h-c1-v2", topic_key: "shipping" })])).rejects.toThrow(/invalid_batch/);
    await expect(commit("b3", [record("c1", { content_hash: "h-c1-v2", classification_key: "topics:v9+x+p1" })])).rejects.toThrow(/invalid_batch/);
    await expect(commit("b4", [record("ghost")])).rejects.toThrow(/invalid_batch/);
    expect(await scalar<number>("select count(*)::int as v from usage_events where event_type='topic_classification'")).toBe(2);
  });

  it("makes an edited comment and a failed verdict due again, and a purged one not", async () => {
    await service();
    await db.query("update comments set content_hash='h-c1-v2', text_raw='نص معدل', text_plain='نص معدل' where external_comment_id='c1'");
    const ids = (await due()).rows.map((r) => r.external_comment_id).sort();
    expect(ids).toEqual(["c1"]); // c2 already has a succeeded verdict on its hash; c3 stays unsupported
    await db.query("delete from topic_predictions where status='succeeded' and comment_id=(select id from comments where external_comment_id='c2')");
    await db.query(`insert into topic_predictions(workspace_id,comment_id,content_hash,classification_key,status,model_id,prompt_version,error_code)
      select $1,id,'h-c2',$2,'failed','gemini-2.5-flash','p1','gemini_unavailable' from comments where external_comment_id='c2'`, [W, KEY]);
    expect((await due()).rows.map((r) => r.external_comment_id).sort()).toEqual(["c1", "c2"]);
  });

  it("refuses the batch when the plan cannot pay for it, charging nothing", async () => {
    await service();
    // Allowance 3, two spent (c1, c2 — charged once ever, so re-classifying
    // them costs nothing). Two comments never charged do not fit.
    await expect(commit("b6", [record("c3", { content_hash: "h-c3" }), record("c4", { content_hash: "h-c4" })])).rejects.toThrow(/quota_exceeded/);
    expect(await scalar<number>("select count(*)::int as v from usage_events where event_type='topic_classification'")).toBe(2);
  });

  it("tells a worker whose model is not the active one to stand down", async () => {
    await service();
    const list = await scalar<{ active: boolean; rows: unknown[] }>(
      "select private.worker_topics_due($1,$2,$3,'some-other-model','p1',200) as v",
      [HASH, job.id, job.lease_token],
    );
    expect(list.active).toBe(false);
    expect(list.rows).toEqual([]);
  });

  it("is lease-checked and refuses a collect job", async () => {
    await service();
    await expect(
      db.query("select private.worker_topics_due($1,$2,'30000000-0000-4000-8000-000000000009',$3,'p1',200)", [HASH, job.id, MODEL]),
    ).rejects.toThrow(/lease_lost/);
    await db.query(
      `insert into jobs(id,workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
       values ('20000000-0000-4000-8000-000000000077',$1,$1,'collect','d-collect','running','30000000-0000-4000-8000-000000000077',now()+interval '10 minutes')`,
      [W],
    );
    await expect(
      db.query("select private.worker_topics_due($1,'20000000-0000-4000-8000-000000000077','30000000-0000-4000-8000-000000000077',$2,'p1',200)", [HASH, MODEL]),
    ).rejects.toThrow(/invalid_job_type/);
    await admin();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [OWNER]);
    await db.exec("set role authenticated");
    await expect(due()).rejects.toThrow();
    await admin();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run supabase/tests/worker_topics.test.ts`
Expected: FAIL — `function private.schedule_due_work` returns no `analyse` count / `worker_topics_due does not exist`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260915161000_the_worker_classifies_topics.sql`:

```sql
-- The worker classifies topics. It is handed the rows that lack a verdict
-- under the key its model produces — with the parent's text for a reply and
-- the taxonomy it must choose from — and commits verdicts idempotently,
-- metered as topic_classification. The tick enqueues one analyse job per
-- channel that has something due.
--
-- Design: docs/superpowers/specs/2026-09-15-topic-classification-design.md

create function private.topic_classification_key(w uuid, model_id text, prompt_version text)
returns text language sql stable security invoker set search_path='' as $$
  select 'topics:v' || ws.topic_taxonomy_version::text || '+' || model_id || '+' || prompt_version
    from public.workspaces ws where ws.id = w
$$;

-- A row is due under a key when its current text has no verdict under that
-- key, or its latest verdict there failed. skipped and unsupported are
-- answers; failed is a promise to try again.
create function private.topic_row_due(w uuid, cm public.comments, k text) returns boolean
language sql stable security invoker set search_path='' as $$
  select not exists (
    select 1 from public.topic_predictions p
     where p.workspace_id = w and p.comment_id = cm.id
       and p.content_hash = cm.content_hash and p.classification_key = k
       and p.status in ('succeeded','skipped','unsupported'))
$$;

-- What the tick asks: is there anything for an analyse job to do on this
-- channel? Under the active key when there is one; before any classification
-- has run, any audience comment with no succeeded verdict at all.
create function private.topics_pending(w uuid, c uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare active text; begin
  select active_topic_key into active from public.workspaces where id = w;
  return exists (
    select 1 from public.comments cm
      join public.videos v on v.workspace_id = w and v.id = cm.video_id
      join public.channels ch on ch.workspace_id = w and ch.id = v.channel_id
     where cm.workspace_id = w and v.channel_id = c
       and (cm.author_channel_id is null or cm.author_channel_id <> ch.external_channel_id)
       and (case when active is null
                 then not exists (select 1 from public.topic_predictions p
                                   where p.workspace_id = w and p.comment_id = cm.id
                                     and p.content_hash = cm.content_hash
                                     and p.status in ('succeeded','skipped','unsupported'))
                 else private.topic_row_due(w, cm, active) end));
end $$;

create function private.worker_topics_due(
  token_hash text, j uuid, t uuid, model_id text, prompt_version text, max_rows int) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w uuid; c uuid; kind text; k text; active text; rows jsonb; taxonomy jsonb; begin
  w := private.worker_job(token_hash, j, t);
  select channel_id, type into c, kind from public.jobs where id = j;
  if kind <> 'analyse' then raise exception 'invalid_job_type' using errcode='22023'; end if;
  if model_id !~ '^[A-Za-z0-9._-]{1,80}$' or prompt_version !~ '^[A-Za-z0-9._-]{1,20}$' then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  k := private.topic_classification_key(w, model_id, prompt_version);
  select active_topic_key into active from public.workspaces where id = w;
  -- A worker running a model that is not the workspace's active one would
  -- store verdicts that never become effective and pay Gemini for each. It is
  -- told so instead, and reports the job blocked.
  if active is not null and active <> k then
    return jsonb_build_object('classification_key', k, 'active', false,
                              'taxonomy', '[]'::jsonb, 'rows', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('key', tp.key, 'description', tp.description)
                            order by tp.position), '[]'::jsonb)
    into taxonomy
    from public.workspace_topics tp where tp.workspace_id = w and tp.retired_at is null;

  select coalesce(jsonb_agg(r), '[]'::jsonb) into rows from (
    select cm.external_comment_id, cm.content_hash,
           -- Purged text goes out as null so the worker records unsupported
           -- rather than sending an empty string to the model.
           case when cm.content_purged_at is null then cm.text_raw end as text,
           case when parent.content_purged_at is null then parent.text_raw end as parent_text,
           cm.is_reply
      from public.comments cm
      join public.videos v on v.workspace_id = w and v.id = cm.video_id
      join public.channels ch on ch.workspace_id = w and ch.id = v.channel_id
      left join public.comments parent on parent.workspace_id = w
        and parent.platform = cm.platform and parent.external_comment_id = cm.external_parent_id
     where cm.workspace_id = w and v.channel_id = c
       and (cm.author_channel_id is null or cm.author_channel_id <> ch.external_channel_id)
       and private.topic_row_due(w, cm, k)
     order by cm.published_at nulls last, cm.id
     limit least(greatest(coalesce(max_rows, 200), 1), 200)
  ) r;
  return jsonb_build_object('classification_key', k, 'active', true,
                            'taxonomy', taxonomy, 'rows', rows);
end $$;

create function private.worker_commit_topics(token_hash text, j uuid, t uuid, b text, records jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  w uuid; kind text; hash text; prior text; keys text[]; covered text[]; wanted int; n int;
begin
  w := private.worker_job(token_hash, j, t);
  select type into kind from public.jobs where id = j;
  if kind <> 'analyse' then raise exception 'invalid_job_type' using errcode='22023'; end if;
  if b is null or length(b) not between 1 and 200 then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  if records is null or jsonb_typeof(records) <> 'array' then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  if jsonb_array_length(records) > 500 then
    raise exception 'batch_too_large' using errcode='22023'; end if;
  -- Every record well-formed or none written. The key must be the one this
  -- server assigns for the record's own model and prompt: a worker cannot
  -- file a verdict under a key it did not earn.
  if exists (
    select 1 from jsonb_array_elements(records) r
     where jsonb_typeof(r) <> 'object'
        or coalesce(r->>'external_comment_id','') = ''
        or coalesce(r->>'content_hash','') = ''
        or r->>'status' not in ('succeeded','skipped','failed','unsupported')
        or ((r->>'status' = 'succeeded') <> (r->>'topic_key' is not null))
        or (r ? 'confidence' and jsonb_typeof(r->'confidence') not in ('number','null'))
        or r->>'classification_key' is distinct from
           private.topic_classification_key(w, r->>'model_id', r->>'prompt_version')) then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  if (select count(distinct r->>'external_comment_id') from jsonb_array_elements(records) r)
     <> jsonb_array_length(records) then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  -- Every named comment is held, and every named topic is live.
  if exists (
    select 1 from jsonb_array_elements(records) r
     where not exists (select 1 from public.comments cm where cm.workspace_id = w
                         and cm.platform = 'youtube' and cm.external_comment_id = r->>'external_comment_id')) then
    raise exception 'invalid_batch' using errcode='22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(records) r
     where r->>'topic_key' is not null
       and not exists (select 1 from public.workspace_topics tp where tp.workspace_id = w
                         and tp.key = r->>'topic_key' and tp.retired_at is null)) then
    raise exception 'invalid_batch' using errcode='22023'; end if;

  hash := encode(sha256(convert_to(records::text, 'UTF8')), 'hex');
  select payload_hash into prior from private.job_batches where job_id = j and batch_key = b;
  if found then
    if prior is distinct from hash then raise exception 'batch_conflict' using errcode='23505'; end if;
    return jsonb_build_object('replayed', true, 'stored', 0);
  end if;

  select coalesce(array_agg(distinct 'topics:youtube:' || (r->>'external_comment_id')), '{}')
    into keys from jsonb_array_elements(records) r where r->>'status' = 'succeeded';
  wanted := coalesce(array_length(keys, 1), 0);
  if wanted > 0 then
    covered := private.reserve_usage(w, 'topic_classification', keys);
    if coalesce(array_length(covered, 1), 0) <> wanted then
      raise exception 'quota_exceeded' using errcode='53400'; end if;
  end if;

  insert into public.topic_predictions(
    workspace_id, comment_id, content_hash, classification_key, status, topic_key,
    confidence, model_id, prompt_version, error_code)
  select w, cm.id, r.content_hash, r.classification_key, r.status, r.topic_key,
         r.confidence, r.model_id, r.prompt_version, r.error_code
    from jsonb_to_recordset(records) as r(
      external_comment_id text, content_hash text, classification_key text, status text,
      topic_key text, confidence numeric, model_id text, prompt_version text, error_code text)
    join public.comments cm on cm.workspace_id = w and cm.platform = 'youtube'
     and cm.external_comment_id = r.external_comment_id
  on conflict (workspace_id, comment_id, content_hash, classification_key) do nothing;
  get diagnostics n = row_count;

  insert into private.job_batches(job_id, batch_key, checkpoint, payload_hash, outcome)
  values (j, b, '{}'::jsonb, hash, 'partial');
  update public.sync_runs set coverage_summary = coalesce(coverage_summary, '{}'::jsonb)
     || jsonb_build_object('topics_stored',
          coalesce((coverage_summary->>'topics_stored')::int, 0) + n)
   where workspace_id = w and job_id = j;
  return jsonb_build_object('replayed', false, 'stored', n);
end $$;

-- schedule_due_work, rebuilt from 20260915132000 with one addition: an
-- analyse job for a channel with unclassified comments.
create or replace function private.schedule_due_work(w uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ch record; d int := 0; k int := 0; a int := 0; cat int; begin
  cat := coalesce(private.plan_limit(w, 'catalogue_interval'), 1440);
  for ch in select id, catalogued_at from public.channels
             where workspace_id = w and status = 'connected' loop
    if ch.catalogued_at is null
       or ch.catalogued_at < now() - make_interval(mins => cat) then
      if private.enqueue_scheduled(w, ch.id, 'discover') is not null then d := d + 1; end if;
    end if;
    if jsonb_array_length(private.due_videos(w, ch.id)) > 0 then
      if private.enqueue_scheduled(w, ch.id, 'collect') is not null then k := k + 1; end if;
    end if;
    if private.topics_pending(w, ch.id) then
      if private.enqueue_scheduled(w, ch.id, 'analyse') is not null then a := a + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('discover', d, 'collect', k, 'analyse', a);
end $$;

create function public.svc_worker_topics_due(
  credential_hash text, j uuid, t uuid, model_id text, prompt_version text, max_rows int)
returns jsonb language sql security invoker set search_path='' as $$
  select private.worker_topics_due(credential_hash, j, t, model_id, prompt_version, max_rows) $$;
create function public.svc_worker_commit_topics(credential_hash text, j uuid, t uuid, b text, records jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.worker_commit_topics(credential_hash, j, t, b, records) $$;

revoke all on function
  private.topic_classification_key(uuid,text,text), private.topic_row_due(uuid,public.comments,text),
  private.topics_pending(uuid,uuid),
  private.worker_topics_due(text,uuid,uuid,text,text,int), private.worker_commit_topics(text,uuid,uuid,text,jsonb),
  public.svc_worker_topics_due(text,uuid,uuid,text,text,int), public.svc_worker_commit_topics(text,uuid,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function
  private.topic_classification_key(uuid,text,text), private.topic_row_due(uuid,public.comments,text),
  private.topics_pending(uuid,uuid),
  private.worker_topics_due(text,uuid,uuid,text,text,int), private.worker_commit_topics(text,uuid,uuid,text,jsonb),
  public.svc_worker_topics_due(text,uuid,uuid,text,text,int), public.svc_worker_commit_topics(text,uuid,uuid,text,jsonb)
  to service_role;
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run supabase/tests/worker_topics.test.ts`
Expected: PASS, all eight.

- [ ] **Step 5: Run the DB suite**

Run: `npm run test:db`
Expected: PASS. `worker_catalogue.test.ts` asserts `schedule_due_work`'s return shape in places; if it uses `toEqual({discover, collect})`, that assertion is stating a fact that has changed — add `analyse: 0` there and say so in the commit.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260915161000_the_worker_classifies_topics.sql supabase/tests/worker_topics.test.ts
git commit -m "The worker is handed what lacks a topic and commits verdicts once, metered"
```

---

### Task 4: The dashboard snapshot carries topics

**Files:**
- Create: `supabase/migrations/20260915162000_the_dashboard_reads_topics.sql`
- Test: `supabase/tests/dashboard_topics.test.ts`

**Interfaces:**
- Produces: `dashboard_snapshot(w)` gains top-level `topics: [{key,name_ar,name_en,description,position,retired}]`, `active_topic_key: text` (`''` when null), and per comment `topic_prediction` (`{status, topic_key, confidence, content_hash, classification_key, model_id, prompt_version, predicted_at, error_code}` or null) and `topic_reviews: [{topic_key, content_hash, created_at, origin, reviewer_id, reason}]`.

- [ ] **Step 1: Write the failing test**

`supabase/tests/dashboard_topics.test.ts`:

```ts
/** The live read carries the taxonomy and each comment's effective topic verdict. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000001";
const C1 = "aaaaaaaa-0000-4000-8000-000000000001";
const KEY = "topics:v1+gemini-2.5-flash+p1";
let db: PGlite;

const as = async (id: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
};
const snapshot = async () =>
  (await db.query<{ v: { topics: { key: string; retired: boolean }[]; active_topic_key: string;
    comments: { id: string; topic_prediction: { topic_key: string; classification_key: string } | null;
                topic_reviews: { topic_key: string; reviewer_id: string }[] }[] } }>(
    "select dashboard_snapshot($1) as v", [W])).rows[0].v;

describe("the dashboard reads topics", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const f of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await db.exec("reset role");
    await db.query("insert into auth.users(id) values ($1)", [OWNER]);
    await db.query("insert into workspaces(id,name,created_by) values ($1,'w',$2)", [W, OWNER]);
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [W, OWNER]);
    await db.query("insert into clients(id,workspace_id,name) values ($1,$1,'c')", [W]);
    await db.query(
      `insert into channels(id,workspace_id,client_id,external_channel_id,status)
       values ($1,$1,$1,$2,'connected')`,
      [W, `UC${"a".repeat(22)}`],
    );
    await db.query(
      `insert into videos(id,workspace_id,channel_id,external_video_id,title,kind)
       values ($1,$1,$1,'vid','حلقة','video')`,
      [W],
    );
    await db.query(
      `insert into comments(id,workspace_id,video_id,external_comment_id,text_raw,text_plain,
        content_hash,timestamp_precision,source,author_name,published_at)
       values ($1,$2,$2,'c1','نص','نص','h1','second','youtube_oauth','مؤلف',now())`,
      [C1, W],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("carries the taxonomy, no active key, and null verdicts before any classification", async () => {
    await as(OWNER);
    const s = await snapshot();
    expect(s.topics).toHaveLength(10);
    expect(s.topics[0]).toMatchObject({ key: "question", retired: false });
    expect(s.active_topic_key).toBe("");
    expect(s.comments[0].topic_prediction).toBeNull();
    expect(s.comments[0].topic_reviews).toEqual([]);
  });

  it("carries the effective verdict only — current hash, active key — and every review", async () => {
    await db.exec("reset role");
    await db.query(
      `insert into topic_predictions(workspace_id,comment_id,content_hash,classification_key,status,topic_key,confidence,model_id,prompt_version)
       values ($1,$2,'h0',$3,'succeeded','praise',0.5,'gemini-2.5-flash','p1'),
              ($1,$2,'h1',$3,'succeeded','question',0.9,'gemini-2.5-flash','p1'),
              ($1,$2,'h1','topics:v1+other+p1','succeeded','humour',0.9,'other','p1')`,
      [W, C1, KEY],
    );
    await as(OWNER);
    await db.query("select submit_topic_review($1,$2,'h1','request','طلب')", [W, C1]);
    const s = await snapshot();
    expect(s.active_topic_key).toBe(KEY);
    expect(s.comments[0].topic_prediction).toMatchObject({ topic_key: "question", classification_key: KEY });
    expect(s.comments[0].topic_reviews).toEqual([
      expect.objectContaining({ topic_key: "request", reviewer_id: OWNER }),
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run supabase/tests/dashboard_topics.test.ts`
Expected: FAIL — `s.topics` is undefined.

- [ ] **Step 3: Write the migration**

Open `supabase/migrations/20260915140000_selection_accounting_and_backoff.sql` and copy lines 96–247 — from `create or replace function private.dashboard_snapshot_impl(w uuid)` through `grant execute on function private.dashboard_snapshot_impl(uuid) to authenticated, service_role;` — into the new file under this header, then make exactly the four edits below.

```sql
-- dashboard_snapshot_impl, rebuilt from 20260915140000 with one change: the
-- read carries the workspace's topic taxonomy, its active classification key,
-- and each comment's effective topic verdict and topic reviews, selected by
-- the same rule as the sentiment prediction — the text as it stands now,
-- under the active key, newest first.
```

Edit 1 — the declare line becomes:

```sql
declare active text; topic_active text; rows jsonb; state jsonb; rev text; taxonomy jsonb;
```

Edit 2 — directly after the `select c.active_analysis_key into active ...` statement, add:

```sql
  select active_topic_key into topic_active from public.workspaces where id = w;

  select coalesce(jsonb_agg(jsonb_build_object(
      'key', tp.key, 'name_ar', tp.name_ar, 'name_en', tp.name_en,
      'description', tp.description, 'position', tp.position,
      'retired', tp.retired_at is not null) order by tp.position), '[]'::jsonb)
    into taxonomy from public.workspace_topics tp where tp.workspace_id = w;
```

Edit 3 — inside the per-row `jsonb_build_object`, directly after the `'reviews', (...)` entry (before the closing `) as row`), add:

```sql
      ,
      'topic_prediction', (
        select jsonb_build_object(
          'status', p.status, 'topic_key', p.topic_key, 'confidence', p.confidence,
          'content_hash', p.content_hash, 'classification_key', p.classification_key,
          'model_id', p.model_id, 'prompt_version', p.prompt_version,
          'predicted_at', p.predicted_at, 'error_code', p.error_code)
        from public.topic_predictions p
        where p.workspace_id=w and p.comment_id=cm.id
          and p.content_hash=cm.content_hash
          and topic_active is not null and p.classification_key=topic_active
        order by p.predicted_at desc limit 1),
      'topic_reviews', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'topic_key', tr.topic_key, 'content_hash', tr.content_hash,
          'created_at', tr.created_at, 'origin', tr.origin,
          'reviewer_id', tr.reviewer_id::text, 'reason', tr.reason
        ) order by tr.created_at), '[]'::jsonb)
        from public.topic_reviews tr
        where tr.workspace_id=w and tr.comment_id=cm.id)
```

Edit 4 — in the final `return jsonb_build_object(...)`, directly after the `'active_analysis_labels', ...` entry, add:

```sql
    'topics', taxonomy,
    'active_topic_key', coalesce(topic_active, ''),
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run supabase/tests/dashboard_topics.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the DB suite**

Run: `npm run test:db`
Expected: PASS. `dashboard_read.test.ts` may assert the exact key set of a comment row or of the top-level object with `toEqual`; if so, add the four new keys to those expectations and say so in the commit.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260915162000_the_dashboard_reads_topics.sql supabase/tests/dashboard_topics.test.ts
git commit -m "The live read carries the taxonomy and each comment's effective topic"
```

---

### Task 5: Contracts — topic schemas, effective topic, filter, snapshot, CSV, fixture

**Files:**
- Create: `packages/contracts/src/topics.ts`, `packages/contracts/src/topics.test.ts`
- Modify: `packages/contracts/src/comments.ts`, `filters.ts`, `snapshot.ts`, `csv.ts`, `fixture.ts`, `usage.ts`, `index.ts`
- Modify: `packages/contracts/src/csv.test.ts`, `contracts.test.ts` (only where an exact-shape assertion now states a changed fact)
- Modify: `apps/web/public/fixtures/dashboard.json`

**Interfaces:**
- Produces:
  - `TopicSchema`, `Topic`; `TopicPredictionSchema`; `TopicReviewSchema`; `TopicReviewInputSchema`, `TopicReviewInput`
  - `UNCLASSIFIED = "__unclassified"`
  - `effectiveTopic(comment: Comment, activeTopicKey: string): { topic: string | null; topic_reviewed: boolean }`
  - `applyTopicReview(comments: Comment[], raw: TopicReviewInput, now: string, reviewerId: string | null): Comment[]`
  - `Comment` gains `topic_prediction`, `topic_reviews`; `Filters` gains `topics: string[]`
  - `snapshot(input, raw, activeKey, activeLabels, activeTopicKey = "")` → adds `topic_counts: Record<string, number>` (topic keys plus `"__unclassified"`), `topics: Topic[]` is **not** here (it comes from the source); `LabelledComment` gains `topic`, `topic_reviewed`
  - `exportRows(input, raw, activeKey, activeTopicKey = "")`
  - `CSV_COLUMNS` gains `effective_topic`, `topic_source`, `classification_key` after `analysis_key`
  - `FixtureSchema`/`LiveSnapshotSchema` gain `topics: z.array(TopicSchema).default([])`, `active_topic_key: z.string().default("")`
  - `BudgetSchema.event_type` gains `"topic_classification"`

- [ ] **Step 1: Write the failing tests**

`packages/contracts/src/topics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyTopicReview, effectiveTopic, UNCLASSIFIED } from "./topics";
import { CommentSchema, type Comment } from "./comments";
import { FiltersSchema } from "./filters";
import { exportRows, snapshot } from "./snapshot";
import { CSV_COLUMNS, toCsv } from "./csv";

const W = "00000000-0000-4000-8000-000000000001";
const KEY = "topics:v1+gemini-2.5-flash+p1";
const base = (over: Partial<Comment> = {}): Comment =>
  CommentSchema.parse({
    id: "c1", workspace_id: W, client_id: "cl", channel_id: "ch", video_id: "v",
    video_kind: "video", author_channel_id: "a", author_name: "مؤلف", text_raw: "نص",
    content_hash: "h1", likes_raw: null, likes_value: null, published_at: null,
    published_time_raw: null, timestamp_precision: "unknown", is_reply: false,
    parent_comment_id: null, parent_source: "unknown", source: "sanitized_fixture",
    field_provenance: {}, comment_type: null, prediction: null, reviews: [],
    ...over,
  });
const pred = (topic_key: string, over: Record<string, unknown> = {}) => ({
  status: "succeeded", topic_key, confidence: 0.8, content_hash: "h1",
  classification_key: KEY, model_id: "gemini-2.5-flash", prompt_version: "p1",
  predicted_at: "2026-09-15T10:00:00Z", error_code: null, ...over,
});
const review = (topic_key: string, over: Record<string, unknown> = {}) => ({
  topic_key, content_hash: "h1", created_at: "2026-09-15T11:00:00Z", origin: "human",
  reviewer_id: "u1", reason: "سبب", ...over,
});

describe("effectiveTopic", () => {
  it("takes the model verdict on the current text under the active key", () => {
    expect(effectiveTopic(base({ topic_prediction: pred("praise") }), KEY))
      .toEqual({ topic: "praise", topic_reviewed: false });
  });
  it("discards a verdict on other text, under another key, or that did not succeed", () => {
    expect(effectiveTopic(base({ topic_prediction: pred("praise", { content_hash: "h0" }) }), KEY).topic).toBeNull();
    expect(effectiveTopic(base({ topic_prediction: pred("praise") }), "topics:v2+x+p1").topic).toBeNull();
    expect(effectiveTopic(base({ topic_prediction: pred("praise", { status: "failed", topic_key: null }) }), KEY).topic).toBeNull();
  });
  it("lets the newest human review on the current text win", () => {
    const c = base({
      topic_prediction: pred("praise"),
      topic_reviews: [review("request"), review("question", { created_at: "2026-09-15T12:00:00Z" }), review("humour", { content_hash: "old" })],
    });
    expect(effectiveTopic(c, KEY)).toEqual({ topic: "question", topic_reviewed: true });
  });
});

describe("applyTopicReview", () => {
  it("appends and refuses a stale hash", () => {
    const [c] = applyTopicReview([base()], { workspace_id: W, comment_id: "c1", content_hash: "h1", topic_key: "request", reason: "سبب" }, "2026-09-15T12:00:00Z", "u1");
    expect(c.topic_reviews).toHaveLength(1);
    expect(() => applyTopicReview([base()], { workspace_id: W, comment_id: "c1", content_hash: "h9", topic_key: "request", reason: "سبب" }, "2026-09-15T12:00:00Z", "u1")).toThrow("stale_comment_text");
  });
});

describe("the topics filter and counts", () => {
  const rows = [
    base({ id: "a", topic_prediction: pred("praise") }),
    base({ id: "b", topic_prediction: pred("question") }),
    base({ id: "c" }),
  ];
  it("narrows every figure by topic, and offers the unclassified", () => {
    const s = snapshot(rows, { workspace_id: W, topics: ["praise"] }, "", [], KEY);
    expect(s.total).toBe(1);
    expect(s.filtered.map((c) => c.id)).toEqual(["a"]);
    expect(snapshot(rows, { workspace_id: W, topics: [UNCLASSIFIED] }, "", [], KEY).filtered.map((c) => c.id)).toEqual(["c"]);
    expect(snapshot(rows, { workspace_id: W }, "", [], KEY).topic_counts).toEqual({ praise: 1, question: 1, [UNCLASSIFIED]: 1 });
  });
  it("counts on the same filtered rows as everything else", () => {
    const s = snapshot(rows, { workspace_id: W, q: "نص", topics: ["question"] }, "", [], KEY);
    expect(s.topic_counts).toEqual({ question: 1, [UNCLASSIFIED]: 0 });
  });
  it("parses the filter", () => {
    expect(FiltersSchema.parse({ workspace_id: W }).topics).toEqual([]);
  });
});

describe("the export", () => {
  it("carries the topic key, its source and the key it came from", () => {
    const i = CSV_COLUMNS.indexOf("analysis_key");
    expect(CSV_COLUMNS.slice(i + 1, i + 4)).toEqual(["effective_topic", "topic_source", "classification_key"]);
    const rows = exportRows([base({ topic_prediction: pred("praise"), topic_reviews: [review("request")] })], { workspace_id: W }, "", KEY);
    const line = toCsv(rows).split("\r\n")[1].split(",");
    expect(line.slice(i + 1, i + 4)).toEqual(["request", "human_review", KEY]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/contracts/src/topics.test.ts`
Expected: FAIL — cannot resolve `./topics`.

- [ ] **Step 3: Create `topics.ts`**

```ts
/** Topics: the taxonomy, model verdicts and human corrections. Mirrors comments.ts. */
import { z } from "zod";
import { timestamp } from "./primitives";
import type { Comment } from "./comments";

/** The filter value that selects rows with no effective topic. */
export const UNCLASSIFIED = "__unclassified";

export const TopicSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    name_ar: z.string().min(1).max(80),
    name_en: z.string().min(1).max(80),
    description: z.string().min(1).max(400),
    position: z.number().int(),
    retired: z.boolean().default(false),
  })
  .strict();
export type Topic = z.infer<typeof TopicSchema>;

export const TopicPredictionSchema = z
  .object({
    status: z.enum(["succeeded", "skipped", "failed", "unsupported"]),
    topic_key: z.string().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    content_hash: z.string().min(1),
    classification_key: z.string().min(1),
    model_id: z.string().min(1),
    prompt_version: z.string().min(1),
    predicted_at: timestamp,
    error_code: z.string().nullable().default(null),
  })
  .strict()
  .refine(
    (v) => (v.status === "succeeded" ? v.topic_key !== null : v.topic_key === null),
    "Only successful predictions have a topic",
  );

export const TopicReviewSchema = z
  .object({
    topic_key: z.string().min(1),
    content_hash: z.string(),
    created_at: timestamp,
    origin: z.enum(["human"]),
    reviewer_id: z.string().min(1).nullable(),
    reason: z.string().nullable(),
  })
  .strict();

export const TopicReviewInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    comment_id: z.string().min(1),
    content_hash: z.string().min(1),
    topic_key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type TopicReviewInput = z.infer<typeof TopicReviewInputSchema>;

/**
 * The same rule as effectiveLabel, on the topic fields: the newest human
 * review on the current text wins; else a succeeded verdict on the current
 * text under the active key; else nothing. One rule, so the two cannot drift.
 */
export function effectiveTopic(
  comment: Comment,
  activeTopicKey: string,
): { topic: string | null; topic_reviewed: boolean } {
  const review = comment.topic_reviews
    .filter((r) => r.origin === "human" && r.content_hash === comment.content_hash)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (review) return { topic: review.topic_key, topic_reviewed: true };
  const p = comment.topic_prediction;
  return {
    topic:
      p?.status === "succeeded" &&
      p.content_hash === comment.content_hash &&
      p.classification_key === activeTopicKey
        ? p.topic_key
        : null,
    topic_reviewed: false,
  };
}

/** Appends a topic correction; pure, as applyReview is. */
export function applyTopicReview(
  comments: Comment[],
  raw: TopicReviewInput,
  now: string,
  reviewerId: string | null,
): Comment[] {
  const input = TopicReviewInputSchema.parse(raw);
  const target = comments.find(
    (c) => c.id === input.comment_id && c.workspace_id === input.workspace_id,
  );
  if (!target) throw new Error("invalid_comment");
  if (target.content_hash !== input.content_hash)
    throw new Error("stale_comment_text");
  const review = {
    topic_key: input.topic_key,
    content_hash: input.content_hash,
    created_at: now,
    origin: "human" as const,
    reviewer_id: reviewerId,
    reason: input.reason,
  };
  return comments.map((c) =>
    c === target ? { ...c, topic_reviews: [...c.topic_reviews, review] } : c,
  );
}
```

- [ ] **Step 4: Extend `comments.ts`**

Add the import at the top: `import { TopicPredictionSchema, TopicReviewSchema } from "./topics";` — and note `topics.ts` imports only the `Comment` *type* from `comments.ts`, so there is no runtime cycle. In `CommentSchema`, directly after `reviews: z.array(ReviewSchema),` add:

```ts
    // The topic dimension, kept apart from sentiment (handoff §A5). Defaults
    // so a fixture or a server that predates topics still parses; the
    // dashboard then shows "no topic classification has run yet".
    topic_prediction: TopicPredictionSchema.nullable().default(null),
    topic_reviews: z.array(TopicReviewSchema).default([]),
```

- [ ] **Step 5: Extend `filters.ts`**

After `sentiments: z.array(LabelSchema).default([]),` add:

```ts
    // Topic keys, or UNCLASSIFIED for rows with no effective topic.
    topics: z.array(z.string().max(40)).max(50).default([]),
```

- [ ] **Step 6: Extend `snapshot.ts`**

Change the imports to add `import { effectiveTopic, UNCLASSIFIED } from "./topics";`. `LabelledComment` becomes:

```ts
export type LabelledComment = Comment & {
  label: Label | null;
  reviewed: boolean;
  topic: string | null;
  topic_reviewed: boolean;
};
```

`filteredRows` takes a fourth parameter `activeTopicKey: string`; its map line becomes:

```ts
    .map((c) => ({ ...c, ...effectiveLabel(c, activeKey), ...effectiveTopic(c, activeTopicKey) }))
```

and directly after the `f.sentiments` check add:

```ts
      if (
        f.topics.length &&
        !f.topics.includes(c.topic ?? UNCLASSIFIED)
      )
        return false;
```

`exportRows` gains `activeTopicKey = ""` as its fourth parameter and passes it through. `snapshot` gains `activeTopicKey = ""` as its fifth parameter and passes it to `filteredRows`. Inside the row loop, add a `topic_counts` accumulator declared before the loop and one line inside it:

```ts
  // One bar per topic, over the same filtered rows as the sentiment figures;
  // the unclassified are counted, never hidden.
  const topic_counts: Record<string, number> = { [UNCLASSIFIED]: 0 };
  for (const c of rows) {
    topic_counts[c.topic ?? UNCLASSIFIED] = (topic_counts[c.topic ?? UNCLASSIFIED] ?? 0) + 1;
    ...existing body...
  }
```

and add `topic_counts,` to the returned object after `sentiments,`.

- [ ] **Step 7: Extend `csv.ts`**

Insert `"effective_topic", "topic_source", "classification_key",` after `"analysis_key",` in `CSV_COLUMNS`. Add:

```ts
function topicSource(row: LabelledComment): string {
  if (row.topic_reviewed) return "human_review";
  return row.topic ? "model" : "none";
}
```

and in `toCsv`, after `r.prediction?.analysis_key ?? "",` add:

```ts
      // The key, not the display name: a rename must not change what an old
      // file says.
      r.topic ?? "",
      topicSource(r),
      r.topic_prediction?.classification_key ?? "",
```

- [ ] **Step 8: Extend `fixture.ts` and `usage.ts`, export from `index.ts`**

`fixture.ts`: import `TopicSchema` from `./topics` and add to `dashboardData` after `active_analysis_labels`:

```ts
  // The workspace's topic taxonomy and the key whose verdicts are effective.
  // Empty means no topic classification has run; the card says so.
  topics: z.array(TopicSchema).default([]),
  active_topic_key: z.string().default(""),
```

`usage.ts`: `event_type: z.enum(["comment_analysis", "historical_backfill", "topic_classification"]),`.

`index.ts`: add `export * from "./topics";` after the comments line.

- [ ] **Step 9: Update the fixture JSON**

Run this once from the repo root; it adds the taxonomy, an active key, and verdicts to the existing seven comments (the last one is left unclassified on purpose, and the third gets a human correction):

```bash
node -e '
const fs=require("fs");const p="apps/web/public/fixtures/dashboard.json";const d=JSON.parse(fs.readFileSync(p,"utf8"));
const T=[["question","استفسارات وأسئلة","Questions & inquiries","Asks the creator or others something, or requests information."],["religious","دعاء وذكر وتعبير ديني","Prayers & religious remarks","Prayer, supplication, remembrance of God, religious phrasing as the main content."],["praise","إشادة ودعم","Praise & support","Compliments, thanks, encouragement toward the creator or content."],["criticism","نقد واعتراض","Criticism & objection","Disagreement, complaint, or negative judgement of the content, creator or subject."],["request","طلبات واقتراحات","Requests & suggestions","Asks for future content, features, changes, or makes a suggestion."],["discussion","نقاش وتحليل الموضوع","Discussion of the subject","Substantive commentary on the topic of the video itself."],["personal","تجارب وقصص شخصية","Personal stories & experiences","Shares the commenter'"'"'s own situation or experience."],["humour","مزاح ودعابة","Humour & banter","Jokes, memes, playful remarks."],["promotion","ترويج ومحتوى دعائي","Promotion & spam","Advertising, self-promotion, links, repeated off-purpose content."],["other","خارج الموضوع / أخرى","Off-topic / other","Does not fit the above or is unrelated to the video."]];
d.topics=T.map(([key,name_ar,name_en,description],i)=>({key,name_ar,name_en,description,position:i+1,retired:false}));
const KEY="topics:v1+gemini-2.5-flash+p1";d.active_topic_key=KEY;
const verdicts=["praise","question","criticism","religious","discussion","praise",null];
d.comments.forEach((c,i)=>{const t=verdicts[i];c.topic_prediction=t?{status:"succeeded",topic_key:t,confidence:[0.93,0.88,0.71,0.97,0.64,0.9][i],content_hash:c.content_hash,classification_key:KEY,model_id:"gemini-2.5-flash",prompt_version:"p1",predicted_at:"2026-09-10T08:00:00Z",error_code:null}:null;c.topic_reviews=i===2?[{topic_key:"request",content_hash:c.content_hash,created_at:"2026-09-11T09:00:00Z",origin:"human",reviewer_id:"fixture-reviewer",reason:"يطلب حلقة عن الموضوع، لا ينتقد"}]:[];});
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");'
```

Then confirm the fixture still parses: `npx vitest run packages/contracts/src/contracts.test.ts`.

- [ ] **Step 10: Run the contracts tests**

Run: `npx vitest run packages/contracts`
Expected: PASS. `csv.test.ts` asserts the header; where it lists the exact columns, add the three new ones — the fact has changed. Any `toEqual` on a parsed comment in `contracts.test.ts` gains `topic_prediction: null, topic_reviews: []`.

- [ ] **Step 11: Typecheck and lint**

Run: `npm run typecheck && npx eslint packages/contracts`
Expected: clean. (`apps/web` will fail typecheck on `snapshot`/`exportRows` call sites only if you changed their arity without defaults; the defaults above keep the old calls valid until Task 10.)

- [ ] **Step 12: Commit**

```bash
git add packages/contracts/src apps/web/public/fixtures/dashboard.json
git commit -m "The contracts know a topic: effective topic, filter, counts, export, fixture"
```

---

### Task 6: Worker — topics package (protocol, deterministic adapter, records)

**Files:**
- Create: `workers/python/src/topics/__init__.py`, `protocol.py`, `deterministic.py`, `analysis.py`
- Test: `workers/python/tests/test_topics.py`

**Interfaces:**
- Produces:
  - `topics.protocol.TopicItem(index: int, text: str | None, parent_text: str | None, is_reply: bool)`
  - `topics.protocol.TopicVerdict(status, topic_key, confidence, error_code)`; `TopicClassifier` protocol with `model_id`, `prompt_version`, `classify(taxonomy: list[dict], items: list[TopicItem]) -> list[TopicVerdict]`
  - `topics.protocol.TopicError(code)`
  - `topics.deterministic.DeterministicTestClassifier`
  - `topics.analysis.classify(classifier, taxonomy, classification_key, rows: list[dict]) -> list[dict]` producing commit records; raises `TopicError("classification_length_mismatch")`.

- [ ] **Step 1: Write the failing test**

`workers/python/tests/test_topics.py`:

```python
"""Topic verdicts as records, without a model."""
import pytest

from topics.analysis import classify
from topics.deterministic import DeterministicTestClassifier
from topics.protocol import TopicError, TopicItem, TopicVerdict

TAXONOMY = [{"key": "question", "description": "asks"}, {"key": "praise", "description": "thanks"},
            {"key": "other", "description": "else"}]
KEY = "topics:v1+deterministic-test-classifier+t1"


def row(i, text="نص", parent=None, reply=False):
    return {"external_comment_id": f"c{i}", "content_hash": f"h{i}", "text": text,
            "parent_text": parent, "is_reply": reply}


def test_a_verdict_is_consistent():
    with pytest.raises(ValueError):
        TopicVerdict(status="succeeded", topic_key=None, confidence=None, error_code=None)
    with pytest.raises(ValueError):
        TopicVerdict(status="failed", topic_key="praise", confidence=None, error_code="x")
    with pytest.raises(ValueError):
        TopicVerdict(status="succeeded", topic_key="praise", confidence=1.5, error_code=None)


def test_deterministic_classifier_is_stable_and_within_the_taxonomy():
    c = DeterministicTestClassifier()
    items = [TopicItem(0, "أ", None, False), TopicItem(1, "ب", "أ", True), TopicItem(2, "أ", None, False)]
    first = c.classify(TAXONOMY, items)
    second = c.classify(TAXONOMY, items)
    assert first == second
    assert first[0] == first[2]
    assert all(v.status == "succeeded" and v.topic_key in {"question", "praise", "other"} for v in first)


def test_records_carry_the_key_and_provenance():
    records = classify(DeterministicTestClassifier(), TAXONOMY, KEY, [row(1), row(2, reply=True, parent="س")])
    assert [r["external_comment_id"] for r in records] == ["c1", "c2"]
    assert records[0]["classification_key"] == KEY
    assert records[0]["model_id"] == "deterministic-test-classifier"
    assert records[0]["prompt_version"] == "t1"
    assert records[0]["status"] == "succeeded"
    assert set(records[0]) == {"external_comment_id", "content_hash", "classification_key", "status",
                               "topic_key", "confidence", "model_id", "prompt_version", "error_code"}


def test_purged_text_is_unsupported_without_a_call():
    class Explodes:
        model_id, prompt_version = "m", "p"

        def classify(self, taxonomy, items):
            raise AssertionError("must not be called")

    records = classify(Explodes(), TAXONOMY, KEY, [row(1, text=None)])
    assert records == [{"external_comment_id": "c1", "content_hash": "h1", "classification_key": KEY,
                        "status": "unsupported", "topic_key": None, "confidence": None,
                        "model_id": "m", "prompt_version": "p", "error_code": "text_purged"}]


def test_a_verdict_outside_the_taxonomy_fails_rather_than_guesses():
    class Invents:
        model_id, prompt_version = "m", "p"

        def classify(self, taxonomy, items):
            return [TopicVerdict("succeeded", "shipping", 0.9, None) for _ in items]

    [r] = classify(Invents(), TAXONOMY, KEY, [row(1)])
    assert (r["status"], r["topic_key"], r["error_code"]) == ("failed", None, "gemini_bad_response")


def test_a_short_answer_is_an_error_not_a_partial_success():
    class Short:
        model_id, prompt_version = "m", "p"

        def classify(self, taxonomy, items):
            return []

    with pytest.raises(TopicError) as e:
        classify(Short(), TAXONOMY, KEY, [row(1)])
    assert e.value.code == "classification_length_mismatch"


def test_empty_input_is_empty_output():
    assert classify(DeterministicTestClassifier(), TAXONOMY, KEY, []) == []
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run worker:test -- tests/test_topics.py`
Expected: FAIL — `ModuleNotFoundError: topics`.

- [ ] **Step 3: Write the package**

`workers/python/src/topics/__init__.py`: empty file.

`workers/python/src/topics/protocol.py`:

```python
"""What a topic classifier is. No model inference is implemented or claimed here."""
from dataclasses import dataclass
from typing import Literal, Protocol

Status = Literal["succeeded", "skipped", "failed", "unsupported"]


class TopicError(Exception):
    """A classification failed for a whole chunk. Carries a code only: a message
    built from a response could echo the request into a log."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class TopicItem:
    index: int
    # None means the text is gone (purged) and the item must not be sent.
    text: str | None
    # The parent's text for a reply; "آمين" alone is unclassifiable.
    parent_text: str | None
    is_reply: bool


@dataclass(frozen=True)
class TopicVerdict:
    status: Status
    topic_key: str | None
    confidence: float | None
    error_code: str | None

    def __post_init__(self):
        if (self.status == "succeeded") != (self.topic_key is not None):
            raise ValueError("Only successful verdicts may name a topic")
        if self.confidence is not None and not 0 <= self.confidence <= 1:
            raise ValueError("Invalid confidence")


class TopicClassifier(Protocol):
    model_id: str
    prompt_version: str

    def classify(self, taxonomy: list[dict], items: list[TopicItem]) -> list[TopicVerdict]: ...
```

`workers/python/src/topics/deterministic.py`:

```python
"""DETERMINISTIC TEST CLASSIFIER — NOT A TOPIC MODEL.

Exists so the pipeline (chunking, records, metering, job outcomes) can be tested
without a network. It hashes the text and picks a topic by the hash; it
understands nothing and its output must never be shown as a model verdict.
"""
import hashlib

from .protocol import TopicItem, TopicVerdict


class DeterministicTestClassifier:
    model_id = "deterministic-test-classifier"
    prompt_version = "t1"

    def classify(self, taxonomy: list[dict], items: list[TopicItem]) -> list[TopicVerdict]:
        keys = [t["key"] for t in taxonomy]
        out = []
        for item in items:
            digest = hashlib.sha256((item.text or "").encode()).digest()
            out.append(TopicVerdict("succeeded", keys[digest[0] % len(keys)], 1.0, None))
        return out
```

`workers/python/src/topics/analysis.py`:

```python
"""Turns due rows into the records commit-topics accepts.

The wiring between a TopicClassifier and the control plane: which comment a
verdict is about, which text it judged, and under which key. Mirrors
server/analysis.py for sentiment.
"""
from typing import Any, Sequence

from .protocol import TopicError, TopicItem, TopicVerdict


def classify(classifier, taxonomy: list[dict], classification_key: str,
             rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """One record per row, in the order given. A shorter or longer answer is an error."""
    if not rows:
        return []
    allowed = {t["key"] for t in taxonomy}
    sendable = [TopicItem(i, r["text"], r.get("parent_text"), bool(r.get("is_reply")))
                for i, r in enumerate(rows) if r.get("text") is not None]
    verdicts: dict[int, TopicVerdict] = {}
    if sendable:
        answers = classifier.classify(taxonomy, sendable)
        if len(answers) != len(sendable):
            raise TopicError("classification_length_mismatch")
        for item, verdict in zip(sendable, answers):
            if verdict.status == "succeeded" and verdict.topic_key not in allowed:
                # A topic nobody chose. Failed, not guessed, not "other".
                verdict = TopicVerdict("failed", None, None, "gemini_bad_response")
            verdicts[item.index] = verdict
    out = []
    for i, r in enumerate(rows):
        v = verdicts.get(i) or TopicVerdict("unsupported", None, None, "text_purged")
        out.append({
            "external_comment_id": r["external_comment_id"],
            "content_hash": r["content_hash"],
            "classification_key": classification_key,
            "status": v.status,
            "topic_key": v.topic_key,
            "confidence": v.confidence,
            "model_id": classifier.model_id,
            "prompt_version": classifier.prompt_version,
            "error_code": v.error_code,
        })
    return out
```

- [ ] **Step 4: Run the tests and lint**

Run: `npm run worker:test -- tests/test_topics.py && npm run worker:lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add workers/python/src/topics workers/python/tests/test_topics.py
git commit -m "A topic classifier is a protocol; verdicts become records the server accepts"
```

---

### Task 7: Worker — the Gemini adapter

**Files:**
- Create: `workers/python/src/topics/gemini.py`
- Test: `workers/python/tests/test_gemini.py`

**Interfaces:**
- Consumes: Task 6's `TopicItem`, `TopicVerdict`, `TopicError`.
- Produces: `topics.gemini.GeminiTopicClassifier(api_key: str, client: httpx.Client, model_id: str = "gemini-2.5-flash", sleep=time.sleep)`; `PROMPT_VERSION = "p1"`; `CHUNK = 25`; `build_prompt(taxonomy, items) -> str`.

- [ ] **Step 1: Write the failing test**

`workers/python/tests/test_gemini.py`:

```python
"""The Gemini adapter, over a fake transport. No request leaves the process."""
import json

import httpx
import pytest

from topics.gemini import CHUNK, PROMPT_VERSION, GeminiTopicClassifier, build_prompt
from topics.protocol import TopicItem

TAXONOMY = [{"key": "question", "description": "asks"}, {"key": "praise", "description": "thanks"}]


def answer(pairs):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(
        [{"index": i, "topic_key": k, "confidence": 0.9} for i, k in pairs])}]}}]}


class Fake:
    def __init__(self, responses):
        self.responses, self.requests = list(responses), []

    def handler(self, request):
        self.requests.append(request)
        status, body = self.responses.pop(0)
        return httpx.Response(status, json=body)

    def classifier(self, **kw):
        return GeminiTopicClassifier("secret-key", httpx.Client(transport=httpx.MockTransport(self.handler)),
                                     sleep=lambda s: None, **kw)


def items(n):
    return [TopicItem(i, f"نص {i}", None, False) for i in range(n)]


def test_the_key_travels_in_a_header_and_never_in_the_url():
    fake = Fake([(200, answer([(0, "praise")]))])
    fake.classifier().classify(TAXONOMY, items(1))
    [req] = fake.requests
    assert "secret-key" not in str(req.url)
    assert req.headers["x-goog-api-key"] == "secret-key"
    assert req.url.path.endswith("/models/gemini-2.5-flash:generateContent")


def test_the_request_constrains_the_answer_to_the_taxonomy():
    fake = Fake([(200, answer([(0, "praise")]))])
    fake.classifier().classify(TAXONOMY, items(1))
    body = json.loads(fake.requests[0].content)
    cfg = body["generationConfig"]
    assert cfg["temperature"] == 0
    assert cfg["responseMimeType"] == "application/json"
    assert cfg["responseSchema"]["items"]["properties"]["topic_key"]["enum"] == ["question", "praise"]
    assert "نص 0" in body["contents"][0]["parts"][0]["text"]


def test_a_reply_is_shown_with_its_parent():
    prompt = build_prompt(TAXONOMY, [TopicItem(0, "آمين", "اللهم اغفر لنا", True)])
    assert "رد على: اللهم اغفر لنا" in prompt
    assert "question — asks" in prompt


def test_chunks_of_twenty_five_and_verdicts_in_order():
    fake = Fake([(200, answer([(i, "praise") for i in range(CHUNK)])),
                 (200, answer([(0, "question"), (1, "praise")]))])
    verdicts = fake.classifier().classify(TAXONOMY, items(CHUNK + 2))
    assert len(fake.requests) == 2
    assert len(verdicts) == CHUNK + 2
    assert verdicts[CHUNK].topic_key == "question"
    # Indices in the second chunk are local to it.
    assert json.loads(fake.requests[1].content)["contents"][0]["parts"][0]["text"].count("[0]") == 1


def test_rate_limit_is_retried_then_fails_the_chunk_with_a_code():
    fake = Fake([(429, {"error": {"message": "https://leak.invalid?key=secret-key"}})] * 3)
    [v] = fake.classifier().classify(TAXONOMY, items(1))
    assert (v.status, v.error_code) == ("failed", "gemini_rate_limited")
    assert len(fake.requests) == 3


def test_server_error_fails_the_chunk_and_a_later_chunk_still_runs():
    fake = Fake([(503, {}), (503, {}), (503, {}), (200, answer([(0, "praise")]))])
    verdicts = fake.classifier().classify(TAXONOMY, items(CHUNK + 1))
    assert all(v.error_code == "gemini_unavailable" for v in verdicts[:CHUNK])
    assert verdicts[CHUNK].topic_key == "praise"


def test_a_missing_index_fails_only_that_item():
    fake = Fake([(200, answer([(1, "praise")]))])
    a, b = fake.classifier().classify(TAXONOMY, items(2))
    assert (a.status, a.error_code) == ("failed", "gemini_bad_response")
    assert b.topic_key == "praise"


def test_unparseable_text_fails_the_chunk():
    fake = Fake([(200, {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]})])
    [v] = fake.classifier().classify(TAXONOMY, items(1))
    assert v.error_code == "gemini_bad_response"


def test_a_blocked_or_empty_candidate_fails_the_chunk():
    fake = Fake([(200, {"candidates": []})])
    [v] = fake.classifier().classify(TAXONOMY, items(1))
    assert v.error_code == "gemini_bad_response"


def test_nothing_raised_carries_the_url():
    fake = Fake([(400, {"error": {"message": "bad request at https://x.invalid?key=secret-key"}})])
    [v] = fake.classifier().classify(TAXONOMY, items(1))
    assert v.status == "failed" and "secret-key" not in (v.error_code or "")


def test_prompt_version_is_declared():
    assert PROMPT_VERSION == "p1"
    assert GeminiTopicClassifier("k", httpx.Client()).prompt_version == "p1"
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run worker:test -- tests/test_gemini.py`
Expected: FAIL — `ModuleNotFoundError: topics.gemini`.

- [ ] **Step 3: Write the adapter**

`workers/python/src/topics/gemini.py`:

```python
"""Gemini as a topic classifier.

One generateContent call per chunk, with the answer constrained by a JSON
schema whose topic_key is an enum of the taxonomy: the model cannot name a
topic nobody chose. The key travels in a header, never in the URL, and nothing
here logs, raises or returns a URL or a response body.

What is sent: the taxonomy (key and description), the comment text, and a
reply's parent text. Never an author, an id, or a workspace.
"""
import json
import time
from typing import Any

import httpx

from .protocol import TopicError, TopicItem, TopicVerdict

PROMPT_VERSION = "p1"
CHUNK = 25
_RETRIES = 2
_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

_INSTRUCTIONS = (
    "أنت مصنِّف موضوعات لتعليقات يوتيوب باللغة العربية بلهجاتها.\n"
    "لكل تعليق مرقَّم أدناه اختر موضوعًا واحدًا فقط من القائمة، بمفتاحه كما هو.\n"
    "الردود تظهر مع نص التعليق الأصلي الذي تردّ عليه؛ صنِّف الردّ لا الأصل.\n"
    "أجب بمصفوفة JSON فقط، عنصر لكل تعليق: {index, topic_key, confidence}.\n"
)


def build_prompt(taxonomy: list[dict], items: list[TopicItem]) -> str:
    lines = [_INSTRUCTIONS, "الموضوعات:"]
    lines += [f"- {t['key']} — {t['description']}" for t in taxonomy]
    lines.append("\nالتعليقات:")
    for local, item in enumerate(items):
        if item.is_reply and item.parent_text:
            lines.append(f"[{local}] رد على: {item.parent_text}\n    الرد: {item.text}")
        else:
            lines.append(f"[{local}] {item.text}")
    return "\n".join(lines)


class GeminiTopicClassifier:
    prompt_version = PROMPT_VERSION

    def __init__(self, api_key: str, client: httpx.Client,
                 model_id: str = "gemini-2.5-flash", sleep=time.sleep):
        if not api_key:
            raise ValueError("missing_gemini_api_key")
        self.model_id = model_id
        self._key, self._client, self._sleep = api_key, client, sleep

    def classify(self, taxonomy: list[dict], items: list[TopicItem]) -> list[TopicVerdict]:
        out: list[TopicVerdict] = []
        for start in range(0, len(items), CHUNK):
            out.extend(self._chunk(taxonomy, items[start:start + CHUNK]))
        return out

    def _chunk(self, taxonomy: list[dict], items: list[TopicItem]) -> list[TopicVerdict]:
        keys = [t["key"] for t in taxonomy]
        body = {
            "contents": [{"role": "user", "parts": [{"text": build_prompt(taxonomy, items)}]}],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "index": {"type": "INTEGER"},
                            "topic_key": {"type": "STRING", "enum": keys},
                            "confidence": {"type": "NUMBER"},
                        },
                        "required": ["index", "topic_key", "confidence"],
                    },
                },
            },
        }
        try:
            answers = self._ask(body)
        except TopicError as exc:
            return [TopicVerdict("failed", None, None, exc.code) for _ in items]
        by_index: dict[int, Any] = {}
        for a in answers:
            if isinstance(a, dict) and isinstance(a.get("index"), int):
                by_index[a["index"]] = a
        verdicts = []
        for local, _ in enumerate(items):
            a = by_index.get(local)
            key = a.get("topic_key") if a else None
            conf = a.get("confidence") if a else None
            if key not in keys or not isinstance(conf, (int, float)):
                verdicts.append(TopicVerdict("failed", None, None, "gemini_bad_response"))
                continue
            verdicts.append(TopicVerdict("succeeded", key, min(max(float(conf), 0.0), 1.0), None))
        return verdicts

    def _ask(self, body: dict) -> list:
        """The parsed answer array, or a TopicError naming why. Retries 429 and 5xx."""
        for attempt in range(_RETRIES + 1):
            try:
                response = self._client.post(
                    f"{_BASE}/{self.model_id}:generateContent",
                    headers={"x-goog-api-key": self._key, "content-type": "application/json"},
                    json=body, timeout=60,
                )
            except httpx.HTTPError:
                # The exception text can carry the URL; only the fact survives.
                if attempt < _RETRIES:
                    self._sleep(2 ** attempt)
                    continue
                raise TopicError("gemini_unavailable") from None
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < _RETRIES:
                    self._sleep(2 ** attempt)
                    continue
                raise TopicError("gemini_rate_limited" if response.status_code == 429
                                 else "gemini_unavailable")
            if response.status_code >= 400:
                raise TopicError("gemini_refused")
            try:
                text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
                parsed = json.loads(text)
            except (ValueError, KeyError, IndexError, TypeError):
                raise TopicError("gemini_bad_response") from None
            if not isinstance(parsed, list):
                raise TopicError("gemini_bad_response")
            return parsed
        raise TopicError("gemini_unavailable")
```

- [ ] **Step 4: Run the tests and lint**

Run: `npm run worker:test -- tests/test_gemini.py && npm run worker:lint`
Expected: PASS, clean.

- [ ] **Step 5: Live check, if Task 1 passed**

Run:
```bash
set -a; source .env.local; set +a; uv --directory workers/python --cache-dir ../../.cache/uv run --frozen python -c "
import httpx
from topics.gemini import GeminiTopicClassifier
from topics.protocol import TopicItem
import os
c = GeminiTopicClassifier(os.environ['GEMINI_API_KEY'], httpx.Client())
tax = [{'key':'question','description':'Asks something.'},{'key':'praise','description':'Thanks or compliments.'},{'key':'religious','description':'Prayer or remembrance of God.'},{'key':'other','description':'Anything else.'}]
print(c.classify(tax, [TopicItem(0,'ما اسم الأغنية في المقدمة؟',None,False), TopicItem(1,'آمين','اللهم اغفر لنا ولوالدينا',True), TopicItem(2,'بارك الله فيك على الحلقة',None,False)]))"
```
Expected: three `succeeded` verdicts, `question` / `religious` / `praise` (or `religious` for the third — both are defensible). Record the actual output in `docs/verification.md` as live-tested. If Task 1 was refused, skip this step and note that in the commit.

- [ ] **Step 6: Commit**

```bash
git add workers/python/src/topics/gemini.py workers/python/tests/test_gemini.py docs/verification.md
git commit -m "Gemini names a topic from the list it is given, and cannot name another"
```

---

### Task 8: Worker — gateway calls, the analyse job, and wiring

**Files:**
- Modify: `workers/python/src/server/gateway.py`, `workers/python/src/server/runner.py`, `workers/python/src/server/loop.py`
- Modify: `.env.example`, `workers/deploy/README.md`
- Test: `workers/python/tests/test_run_topics.py`

**Interfaces:**
- Consumes: Task 6's `classify`, `TopicError`; Task 7's classifier; Task 3's RPC shapes.
- Produces:
  - `ControlPlane.topics_due(lease, model_id, prompt_version, max_rows=200) -> dict` posting `/worker/topics-due`
  - `ControlPlane.commit_topics(lease, batch_key, records) -> dict` posting `/worker/commit-topics`
  - `server.runner.run_topics(control, lease, classifier) -> bool`; `run_job(control, build_collector, analyzer=None, classifier=None)` dispatching `type == "analyse"`
  - `serve(..., classifier=None)`; `main()` building the classifier from `GEMINI_API_KEY` or `--topics deterministic-test`.

- [ ] **Step 1: Write the failing test**

`workers/python/tests/test_run_topics.py`:

```python
"""An analyse job, over a synthetic control plane."""
import hashlib
import json

import httpx

from server.gateway import ControlPlane
from server.runner import run_job
from topics.deterministic import DeterministicTestClassifier
from topics.protocol import TopicVerdict

KEY = "topics:v1+deterministic-test-classifier+t1"
TAX = [{"key": "question", "description": "asks"}, {"key": "praise", "description": "thanks"}]


class Plane:
    def __init__(self, due=(), active=True, refuse_commit=None):
        self.due_lists = [list(d) for d in due]
        self.active, self.refuse_commit = active, refuse_commit
        self.calls, self.committed, self.finished = [], [], None

    def handler(self, request):
        path = request.url.path.rsplit("/", 1)[-1]
        self.calls.append(path)
        body = json.loads(request.content) if request.content else {}
        if path == "claim":
            return httpx.Response(200, json={"job_id": "j1", "lease_token": "t1", "type": "analyse",
                                             "checkpoint": None, "access_token": None})
        if path == "topics-due":
            assert body["model_id"] == "deterministic-test-classifier"
            rows = self.due_lists.pop(0) if self.due_lists else []
            return httpx.Response(200, json={"classification_key": KEY, "active": self.active,
                                             "taxonomy": TAX, "rows": rows})
        if path == "commit-topics":
            self.committed.append(body)
            if self.refuse_commit:
                return httpx.Response(429, json={"code": self.refuse_commit})
            return httpx.Response(200, json={"replayed": False, "stored": len(body["records"])})
        if path == "finish":
            self.finished = (body["outcome"], body.get("error_code"))
        return httpx.Response(200, json={})

    def plane(self):
        return ControlPlane("https://c.invalid", "cred", httpx.Client(transport=httpx.MockTransport(self.handler)))


def row(i, text="نص"):
    return {"external_comment_id": f"c{i}", "content_hash": f"h{i}", "text": text, "parent_text": None, "is_reply": False}


def test_classifies_until_the_due_list_is_empty_then_succeeds():
    plane = Plane(due=[[row(1), row(2)], [row(3)], []])
    assert run_job(plane.plane(), None, classifier=DeterministicTestClassifier()) is True
    assert [c["records"][0]["external_comment_id"] for c in plane.committed] == ["c1", "c3"]
    assert plane.committed[0]["records"][0]["classification_key"] == KEY
    assert plane.finished == ("succeeded", None)
    assert plane.calls.count("heartbeat") >= 2
    # The batch key is the sorted ids' digest, so a retry of the same rows replays.
    expected = hashlib.sha256("c1,c2".encode()).hexdigest()[:32]
    assert plane.committed[0]["batch_key"] == expected


def test_no_classifier_blocks_the_job_and_says_why():
    plane = Plane(due=[[row(1)]])
    assert run_job(plane.plane(), None, classifier=None) is True
    assert plane.committed == []
    assert plane.finished == ("blocked", "no_topic_classifier")


def test_an_inactive_model_blocks_the_job():
    plane = Plane(due=[[]], active=False)
    run_job(plane.plane(), None, classifier=DeterministicTestClassifier())
    assert plane.finished == ("blocked", "topic_model_not_active")


def test_a_failed_item_makes_the_job_partial_with_the_first_code():
    class Flaky:
        model_id, prompt_version = "deterministic-test-classifier", "t1"

        def classify(self, taxonomy, items):
            return [TopicVerdict("failed", None, None, "gemini_rate_limited") if i.index == 0
                    else TopicVerdict("succeeded", "praise", 0.9, None) for i in items]

    plane = Plane(due=[[row(1), row(2)], []])
    run_job(plane.plane(), None, classifier=Flaky())
    assert [r["status"] for r in plane.committed[0]["records"]] == ["failed", "succeeded"]
    assert plane.finished == ("partial", "gemini_rate_limited")


def test_quota_exhausted_blocks_without_looping():
    plane = Plane(due=[[row(1)], [row(1)]], refuse_commit="quota_exceeded")
    run_job(plane.plane(), None, classifier=DeterministicTestClassifier())
    assert len(plane.committed) == 1
    assert plane.finished == ("blocked", "quota_exceeded")


def test_a_due_list_that_never_shrinks_stops_after_a_bound():
    # A server that keeps returning the same rows (a bug) must not spin forever.
    plane = Plane(due=[[row(1)]] * 100)
    run_job(plane.plane(), None, classifier=DeterministicTestClassifier())
    assert len(plane.committed) <= 50
    assert plane.finished[0] == "partial"
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run worker:test -- tests/test_run_topics.py`
Expected: FAIL — `run_job() got an unexpected keyword argument 'classifier'`.

- [ ] **Step 3: Add the gateway calls**

In `workers/python/src/server/gateway.py`, after `def tick(self)`, add:

```python
    def topics_due(self, lease: dict[str, Any], model_id: str, prompt_version: str,
                   max_rows: int = 200) -> dict[str, Any]:
        """The rows this analyse job should classify, and the key they will be filed under."""
        data = self._post("/worker/topics-due", {
            "job_id": lease["job_id"], "lease_token": lease["lease_token"],
            "model_id": model_id, "prompt_version": prompt_version, "max_rows": max_rows,
        })
        return data or {}

    def commit_topics(self, lease: dict[str, Any], batch_key: str,
                      records: list[dict[str, Any]]) -> dict[str, Any] | None:
        return self._post("/worker/commit-topics", {
            "job_id": lease["job_id"], "lease_token": lease["lease_token"],
            "batch_key": batch_key, "records": records,
        })
```

- [ ] **Step 4: Add the job branch**

In `workers/python/src/server/runner.py`, add to the imports:

```python
import hashlib

from topics.analysis import classify
from topics.protocol import TopicError
```

Add before `run_job`:

```python
# How many due lists one analyse job will work through before standing down.
# 50 × 200 rows is ten thousand verdicts; a list that never shrinks is a bug,
# not a backlog, and the job says partial rather than spinning on it.
_TOPIC_ROUNDS = 50


def run_topics(control: ControlPlane, lease: dict, classifier) -> bool:
    """Classify what the server says lacks a topic, until it says nothing does.

    Each round asks for up to 200 rows under the key the server assigns for
    this classifier, commits their verdicts under a key derived from their ids
    (so a retry replays instead of re-charging), and asks again. Gemini's own
    failures arrive as failed verdicts and make the job partial; the control
    plane's refusals end it blocked.
    """
    if classifier is None:
        control.finish(lease, "blocked", "no_topic_classifier")
        return True
    first_failure: str | None = None
    rounds = 0
    try:
        while True:
            due = control.topics_due(lease, classifier.model_id, classifier.prompt_version)
            if not due.get("active", False):
                control.finish(lease, "blocked", "topic_model_not_active")
                return True
            rows = [r for r in due.get("rows") or [] if isinstance(r, dict)]
            if not rows:
                break
            rounds += 1
            if rounds > _TOPIC_ROUNDS:
                first_failure = first_failure or "topics_due_list_not_shrinking"
                break
            control.heartbeat(lease)
            try:
                records = classify(classifier, due.get("taxonomy") or [],
                                   due["classification_key"], rows)
            except TopicError as exc:
                first_failure = first_failure or exc.code
                break
            for r in records:
                if r["status"] == "failed" and first_failure is None:
                    first_failure = r["error_code"] or "classification_failed"
            ids = ",".join(sorted(r["external_comment_id"] for r in records))
            key = hashlib.sha256(ids.encode()).hexdigest()[:32]
            control.commit_topics(lease, key, records)
        control.finish(lease, "partial" if first_failure else "exhausted", first_failure)
    except LeaseLost:
        raise
    except ControlPlaneError as exc:
        if exc.retryable:
            raise
        control.finish(lease, "blocked", exc.code)
    return True
```

Change the `ControlPlane, LeaseLost` import line to `from .gateway import ControlPlane, ControlPlaneError, LeaseLost`, and `run_job` to:

```python
def run_job(control: ControlPlane, build_collector, analyzer=None, classifier=None) -> bool:
    """Claim whatever is next and run it by its type. False means no work.

    The claim is consumed here; the lease is handed down rather than claiming
    twice — a job must never be claimed twice.
    """
    lease = control.claim()
    if lease is None:
        return False
    if lease.get("type") == "discover":
        return _discover(control, lease, build_collector)
    if lease.get("type") == "analyse":
        return run_topics(control, lease, classifier)
    return _backfill(control, lease, build_collector, analyzer)
```

- [ ] **Step 5: Wire the loop**

In `workers/python/src/server/loop.py`: `serve` gains `classifier=None` after `analyzer=None` and passes `classifier=classifier` in `run(control, build, analyzer=analyzer, classifier=classifier)`. In `main()`, add the argument:

```python
    p.add_argument("--topics", default="gemini" if os.environ.get("GEMINI_API_KEY") else "none",
                   choices=["none", "deterministic-test", "gemini"],
                   help="topic classifier; gemini needs GEMINI_API_KEY")
```

and, after the analyzer is built and before `client = httpx.Client()`:

```python
    client = httpx.Client()
    classifier = None
    if args.topics == "gemini":
        from topics.gemini import GeminiTopicClassifier

        key = os.environ.get("GEMINI_API_KEY", "")
        if not key:
            raise SystemExit("--topics gemini needs GEMINI_API_KEY")
        classifier = GeminiTopicClassifier(key, client)
        _log(f"topic classifier: {classifier.model_id}")
    elif args.topics == "deterministic-test":
        from topics.deterministic import DeterministicTestClassifier

        classifier = DeterministicTestClassifier()
```

(remove the original `client = httpx.Client()` line below so the client is created once), pass `classifier=classifier` to `serve`, and extend the "worker up" log to `topics={args.topics}`.

Check `workers/python/tests/test_loop.py` for a `run` stub whose signature is `(control, build, analyzer=None)`; it now receives `classifier=` too — give the stub `**_` or `classifier=None`.

- [ ] **Step 6: Document the variable**

`.env.example`: after `MODEL_DEVICE=` add `GEMINI_API_KEY=`. `workers/deploy/README.md`, in the `.env` block, add a line `GEMINI_API_KEY=<the Gemini key, for topic classification>` and a sentence after it: "Without it the worker still collects and labels sentiment; topic jobs are reported blocked with `no_topic_classifier`."

- [ ] **Step 7: Run the worker suite and lint**

Run: `npm run worker:test && npm run worker:lint`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add workers/python/src/server workers/python/tests/test_run_topics.py workers/python/tests/test_loop.py .env.example workers/deploy/README.md
git commit -m "An analyse job classifies what the server hands it, in rounds, and ends honestly"
```

---

### Task 9: Edge gateway — two routes

**Files:**
- Modify: `supabase/functions/_shared/worker-gateway.ts`, `supabase/functions/worker/index.ts`
- Test: `packages/contracts/src/workerGateway.test.ts`

**Interfaces:**
- Consumes: Task 3's `svc_worker_topics_due` / `svc_worker_commit_topics`.
- Produces: `WorkerDb.topicsDue(credentialHash, jobId, leaseToken, modelId, promptVersion, maxRows)`, `WorkerDb.commitTopics(credentialHash, jobId, leaseToken, batchKey, records)`; routes `/worker/topics-due` and `/worker/commit-topics`.

- [ ] **Step 1: Write the failing test**

Append inside the `describe("worker gateway", ...)` block in `packages/contracts/src/workerGateway.test.ts`:

```ts
  it("routes the topic pair with only the fields the database reads", async () => {
    const store = db({
      topicsDue: vi.fn(async () => ({ classification_key: "k", active: true, taxonomy: [], rows: [] })),
      commitTopics: vi.fn(async () => ({ replayed: false, stored: 2 })),
    });
    const due = await handleWorkerRequest(
      post("/worker/topics-due", {
        job_id: "j1", lease_token: "t1", model_id: "gemini-2.5-flash", prompt_version: "p1",
        max_rows: 50, workspace_id: "ignored",
      }),
      store,
    );
    expect(due.status).toBe(200);
    expect(store.topicsDue).toHaveBeenCalledWith(HASHED, "j1", "t1", "gemini-2.5-flash", "p1", 50);
    const commit = await handleWorkerRequest(
      post("/worker/commit-topics", {
        job_id: "j1", lease_token: "t1", batch_key: "b", records: [{ external_comment_id: "c1" }],
      }),
      store,
    );
    expect(await commit.json()).toEqual({ replayed: false, stored: 2 });
    expect(store.commitTopics).toHaveBeenCalledWith(HASHED, "j1", "t1", "b", [{ external_comment_id: "c1" }]);
    for (const [path, body] of [
      ["/worker/topics-due", { job_id: "j1", lease_token: "t1", prompt_version: "p1" }],
      ["/worker/commit-topics", { job_id: "j1", lease_token: "t1", batch_key: "b", records: "no" }],
    ] as const) {
      const r = await handleWorkerRequest(post(path, body), store);
      expect(r.status).toBe(400);
    }
    const typed = await handleWorkerRequest(
      post("/worker/commit-topics", { job_id: "j1", lease_token: "t1", batch_key: "b", records: [] }),
      db({ commitTopics: vi.fn(async () => { throw { message: "invalid_job_type" }; }) }),
    );
    expect(typed.status).toBe(400);
    expect(await typed.json()).toEqual({ code: "invalid_job_type" });
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/contracts/src/workerGateway.test.ts`
Expected: FAIL — 404 `not_found` on `/worker/topics-due`.

- [ ] **Step 3: Add the interface, the status, and the routes**

In `worker-gateway.ts`, add to `WorkerDb` after `videoFinished`:

```ts
  /** The rows an analyse job should classify, under the key the server assigns. */
  topicsDue(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
    modelId: string,
    promptVersion: string,
    maxRows: number,
  ): Promise<unknown>;
  commitTopics(
    credentialHash: string,
    jobId: string,
    leaseToken: string,
    batchKey: string,
    records: unknown[],
  ): Promise<unknown>;
```

Add `invalid_job_type: 400,` to `STATUS` after `invalid_video`. Add `"/worker/topics-due", "/worker/commit-topics",` to the `leased` array. After the `/worker/video-finished` branch add:

```ts
    if (path.endsWith("/worker/topics-due")) {
      const model = str(body, "model_id");
      const prompt = str(body, "prompt_version");
      const max = typeof body.max_rows === "number" ? body.max_rows : 200;
      if (!model || !prompt) return refuse("invalid_batch");
      return json(200, await db.topicsDue(credential, job, lease, model, prompt, max));
    }
    if (path.endsWith("/worker/commit-topics")) {
      const key = str(body, "batch_key");
      if (!key || !Array.isArray(body.records)) return refuse("invalid_batch");
      return json(200, await db.commitTopics(credential, job, lease, key, body.records));
    }
```

In `worker/index.ts`, after `videoFinished`:

```ts
    topicsDue: async (hash, j, t, modelId, promptVersion, maxRows) => {
      const { data, error } = await db.rpc("svc_worker_topics_due", {
        credential_hash: hash, j, t, model_id: modelId, prompt_version: promptVersion, max_rows: maxRows,
      });
      if (error) failed(error);
      return data;
    },
    commitTopics: async (hash, j, t, b, records) => {
      const { data, error } = await db.rpc("svc_worker_commit_topics", {
        credential_hash: hash, j, t, b, records,
      });
      if (error) failed(error);
      return data;
    },
```

- [ ] **Step 4: Run the tests and the function check**

Run: `npx vitest run packages/contracts/src/workerGateway.test.ts && npm run check:functions`
Expected: PASS; the Deno check clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions packages/contracts/src/workerGateway.test.ts
git commit -m "The gateway routes the topic pair and reads nothing the database does not"
```

---

### Task 10: Dashboard — chart, filter, chip, correction, plan line, job kind

**Files:**
- Modify: `apps/web/src/data.ts`, `apps/web/src/Dashboard.tsx`, `apps/web/src/report.css`, `apps/web/src/jobFeed.ts`, `apps/web/src/OperationsPanels.tsx`, `apps/web/src/planWords.ts` (only if it enumerates budgets), `apps/web/src/strings/ar.ts`, `apps/web/src/strings/en.ts`
- Test: `apps/web/src/jobFeed.test.ts`, `apps/web/src/data.test.ts`, `tests/e2e/dashboard.spec.ts` (append)

**Interfaces:**
- Consumes: Task 5's `effectiveTopic`, `UNCLASSIFIED`, `topic_counts`, `TopicReviewInput`, `applyTopicReview`; `dashboard_snapshot`'s `topics`/`active_topic_key`; `submit_topic_review` RPC.
- Produces: `submitTopicReview(mode, input: TopicReviewInput)` in `data.ts`; `describeJob` headline prefixed for `analyse` jobs; a `budgetTopics` string; the Topics card, filter, chip and correction mode.

- [ ] **Step 1: Write the failing unit tests**

Append to `apps/web/src/jobFeed.test.ts` inside `describe("describeJob")`:

```ts
  it("names a topic job as one, and explains its own codes", () => {
    const topics = describeJob(
      { ...row(), type: "analyse", status: "blocked", error_code: "no_topic_classifier" },
      { workerConnected: true },
      ar,
    );
    expect(topics.headline).toContain(ar.jobKindTopics);
    expect(topics.detail).toBe(ar.jobNoTopicClassifier);
    expect(explainCode("gemini_rate_limited", ar)).toBe(ar.jobGeminiRateLimited);
    expect(explainCode("gemini_unavailable", ar)).toBe(ar.jobGeminiUnavailable);
    expect(explainCode("gemini_bad_response", ar)).toBe(ar.jobGeminiBadResponse);
    expect(explainCode("topic_model_not_active", ar)).toBe(ar.jobTopicModelNotActive);
  });
```

Append to `apps/web/src/data.test.ts` (it already tests fixture-mode `submitReview`; mirror its setup for the fixture fetch) a test that `submitTopicReview("sanitized_fixture", {...})` with a stale hash rejects with `stale_comment_text`, and that after a valid one `loadSource("sanitized_fixture", W)` returns the comment with one `topic_reviews` entry.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run apps/web/src/jobFeed.test.ts apps/web/src/data.test.ts`
Expected: FAIL — `ar.jobKindTopics` undefined; `submitTopicReview` not exported.

- [ ] **Step 3: Strings**

Add to `apps/web/src/strings/ar.ts` (next to the existing `topicsTitle` block, `budgetBackfill`, and `jobQuotaExceeded` respectively), and the typed English twins to `en.ts`:

```ts
  // Topics
  topicsNotRunStrong: "لم يُشغَّل تصنيف الموضوعات بعد",
  topicsNotRunLead:
    "يحتاج تصنيف التعليقات إلى موضوعات طبقةَ نموذجٍ لغوي يشغّلها العامل. ما إن تعمل، تظهر هنا الموضوعات بأعدادها.",
  topicsUnclassified: (n: string) => `${n} لم تُصنَّف بعد`,
  topicsCaption: "التعليقات حسب الموضوع",
  topicsUnit: "الموضوع",
  topicFilterLabel: "الموضوع",
  topicAll: "كل الموضوعات",
  topicUnclassifiedOption: "غير مصنَّف بعد",
  topicNone: "بلا موضوع",
  chipTopic: (name: string) => `الموضوع: ${name}`,
  correctTopic: "تصحيح الموضوع",
  correctTopicFor: (author: string) => `تصحيح موضوع تعليق ${author}`,
  correctTopicLabel: "الموضوع الصحيح",
  reviewTopicTitle: "تصحيح الموضوع",
  reviewTopicCurrent: (topic: string) => `الموضوع الحالي: ${topic}`,
  reviewKindSentiment: "التصنيف",
  reviewKindTopic: "الموضوع",
  budgetTopics: "تصنيف الموضوعات",
  jobKindTopics: "تصنيف الموضوعات",
  jobNoTopicClassifier:
    "لا يوجد مصنِّف موضوعات مهيّأ لدى العامل. أضف مفتاح Gemini إلى إعدادات العامل ليعمل التصنيف.",
  jobTopicModelNotActive:
    "نموذج الموضوعات الذي يشغّله العامل ليس النموذج الفعّال في مساحة العمل، فلم يُصنَّف شيء.",
  jobGeminiRateLimited: "أوقف Gemini الطلبات مؤقتًا لتجاوز الحد. تُعاد المحاولة لاحقًا.",
  jobGeminiUnavailable: "لم يستجب Gemini. تُعاد المحاولة لاحقًا.",
  jobGeminiBadResponse: "أجاب Gemini بصيغة غير متوقعة لبعض التعليقات؛ ستُعاد محاولتها.",
```

English (`en.ts`):

```ts
  topicsNotRunStrong: "Topic classification has not run yet",
  topicsNotRunLead:
    "Sorting comments into topics needs a language-model layer run by the worker. Once it runs, the topics and their counts appear here.",
  topicsUnclassified: (n: string) => `${n} not yet classified`,
  topicsCaption: "Comments by topic",
  topicsUnit: "Topic",
  topicFilterLabel: "Topic",
  topicAll: "All topics",
  topicUnclassifiedOption: "Not yet classified",
  topicNone: "no topic",
  chipTopic: (name: string) => `Topic: ${name}`,
  correctTopic: "Correct topic",
  correctTopicFor: (author: string) => `Correct the topic of ${author}'s comment`,
  correctTopicLabel: "Correct topic",
  reviewTopicTitle: "Correct the topic",
  reviewTopicCurrent: (topic: string) => `Current topic: ${topic}`,
  reviewKindSentiment: "sentiment",
  reviewKindTopic: "topic",
  budgetTopics: "Topic classification",
  jobKindTopics: "Topic classification",
  jobNoTopicClassifier:
    "The worker has no topic classifier configured. Add the Gemini key to the worker's settings for classification to run.",
  jobTopicModelNotActive:
    "The topic model the worker runs is not this workspace's active one, so nothing was classified.",
  jobGeminiRateLimited: "Gemini paused requests for exceeding its limit. It will be retried.",
  jobGeminiUnavailable: "Gemini did not respond. It will be retried.",
  jobGeminiBadResponse: "Gemini answered in an unexpected shape for some comments; they will be retried.",
```

The existing `topicsUnavailableStrong` / `topicsUnavailableLead` keys stay (the "no classifier" branch still uses `topicsNotRun*`; delete the old two only if nothing else references them — `grep -rn topicsUnavailable apps/web/src`).

- [ ] **Step 4: `jobFeed.ts`**

In `explain`, add cases before `default`:

```ts
    case "no_topic_classifier":
      return S.jobNoTopicClassifier;
    case "topic_model_not_active":
      return S.jobTopicModelNotActive;
    case "gemini_rate_limited":
      return S.jobGeminiRateLimited;
    case "gemini_unavailable":
      return S.jobGeminiUnavailable;
    case "gemini_bad_response":
      return S.jobGeminiBadResponse;
```

In `describeJob`, wrap the returned entry: compute the entry as today into `const entry = (() => { switch ... })();` — or, less invasively, rename the current function body to `describeJobStatus` and have `describeJob` do:

```ts
export function describeJob(job: JobRow, opts: { workerConnected: boolean }, S: Strings): JobEntry {
  const entry = describeJobStatus(job, opts, S);
  // A topic job is a different kind of work and is named as such in the log,
  // so a blocked topic job is not read as a stalled collection.
  return job.type === "analyse"
    ? { ...entry, headline: `${S.jobKindTopics} — ${entry.headline}` }
    : entry;
}
```

- [ ] **Step 5: `data.ts`**

Import `applyTopicReview`, `TopicReviewInputSchema`, `type TopicReviewInput` from `@sentiment/contracts`. Add a second session store and apply it in `withSessionReviews`:

```ts
const sessionTopicReviews: { input: TopicReviewInput; at: string }[] = [];

function withSessionReviews(comments: Comment[]): Comment[] {
  const labelled = sessionReviews.reduce(
    (acc, r) => applyReview(acc, r.input, r.at, fixtureReviewer),
    comments,
  );
  return sessionTopicReviews.reduce(
    (acc, r) => applyTopicReview(acc, r.input, r.at, fixtureReviewer),
    labelled,
  );
}
```

Pass `source.active_topic_key` as the fifth argument of `snapshot(...)` in `deriveSnapshot` and as the fourth of `exportRows(...)` in `buildExport`. Add after `submitReview`:

```ts
export async function submitTopicReview(mode: DataMode, raw: TopicReviewInput) {
  const input = TopicReviewInputSchema.parse(raw);
  if (mode === "live") {
    const { error } = await supabase!.rpc("submit_topic_review", {
      w: input.workspace_id,
      c: input.comment_id,
      seen_hash: input.content_hash,
      topic: input.topic_key,
      why: input.reason,
    });
    if (error) throw new Error("review_rejected");
    return;
  }
  const fixture = await readFixture();
  applyTopicReview(
    withSessionReviews(fixture.comments),
    input,
    new Date().toISOString(),
    fixtureReviewer,
  );
  sessionTopicReviews.push({ input, at: new Date().toISOString() });
}
```

Also export `topics` and `active_topic_key` on the derived snapshot: in `deriveSnapshot`'s returned object add `topics: source.topics, active_topic_key: source.active_topic_key,`.

- [ ] **Step 6: `Dashboard.tsx`**

Work through these edits in order; each is small.

(a) **State and filter.** Beside `const [sentiment, setSentiment] = useState("")` add `const [topic, setTopic] = useState("");`. In `filtersFrom` add `topics: topic ? [topic] : [],`. In `reset()` add `setTopic("");`. In `activeFilters`, after the sentiment chip, add `topic && S.chipTopic(topic === UNCLASSIFIED ? S.topicUnclassifiedOption : topicName(topic)),` where, near the top of the component:

```ts
  const topicName = (key: string) =>
    result.data?.topics.find((t) => t.key === key)?.[lang === "ar" ? "name_ar" : "name_en"] ?? key;
```

Import `UNCLASSIFIED` from `@sentiment/contracts`.

(b) **Filter control.** After the sentiment `<select>` label, add (only when the source has a taxonomy):

```tsx
        {(result.data?.topics ?? []).length > 0 && (
          <label>
            {S.topicFilterLabel}
            <select
              aria-label={S.topicFilterLabel}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            >
              <option value="">{S.topicAll}</option>
              {(result.data?.topics ?? [])
                .filter((t) => !t.retired)
                .map((t) => (
                  <option key={t.key} value={t.key}>
                    {lang === "ar" ? t.name_ar : t.name_en}
                  </option>
                ))}
              <option value={UNCLASSIFIED}>{S.topicUnclassifiedOption}</option>
            </select>
          </label>
        )}
```

(c) **The Topics card.** Replace the `<article className="rp-card">` at the current `S.topicsTitle` (the one holding `topicsUnavailableStrong`) with:

```tsx
                  <article className="rp-card" data-testid="topics-card">
                    <h3>{S.topicsTitle}</h3>
                    {!s.active_topic_key ? (
                      <p className="rp-missing">
                        <strong>{S.topicsNotRunStrong}</strong>
                        {S.topicsNotRunLead}
                      </p>
                    ) : (
                      (() => {
                        const buckets = s.topics
                          .filter((t) => !t.retired)
                          .map((t) => ({
                            key: t.key,
                            label: lang === "ar" ? t.name_ar : t.name_en,
                            count: s.topic_counts[t.key] ?? 0,
                          }))
                          .filter((b) => b.count > 0)
                          .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "en"));
                        const unclassified = s.topic_counts[UNCLASSIFIED] ?? 0;
                        return (
                          <>
                            {buckets.length > 0 && (
                              <div className="rp-chart rp-chart-topics" aria-hidden="true">
                                <Bar
                                  data={{
                                    labels: buckets.map((b) => b.label),
                                    datasets: [{ data: buckets.map((b) => b.count), backgroundColor: VOLUME, borderRadius: 4 }],
                                  }}
                                  options={{ ...barOptions, indexAxis: "y" as const, animation: false }}
                                />
                              </div>
                            )}
                            <ChartFigures caption={S.topicsCaption} unit={S.topicsUnit} buckets={buckets} />
                            {unclassified > 0 && (
                              <p className="rp-metric-note" data-testid="topics-unclassified">
                                {S.topicsUnclassified(n(unclassified))}
                              </p>
                            )}
                          </>
                        );
                      })()
                    )}
                  </article>
```

`report.css`: add `.rp-chart-topics { height: 16rem; }` beside the other `.rp-chart` heights.

(d) **The row chip.** In the comments table, in the cell that renders the sentiment `rp-chip`, after `{c.reviewed && <small>{S.humanReview}</small>}` add:

```tsx
                            {s.active_topic_key && (
                              <span className="rp-chip rp-chip-topic" data-topic={c.topic ?? "none"} data-testid="topic-chip">
                                {c.topic ? topicName(c.topic) : S.topicNone}
                                {c.topic_reviewed && <small>{S.humanReview}</small>}
                              </span>
                            )}
```

`report.css`: `.rp-chip-topic { margin-inline-start: .35rem; background: var(--surface-2, #f1effa); color: inherit; }` — read the existing `.rp-chip` rule and reuse its variables rather than these fallbacks if it names them differently.

(e) **The correction mode.** Beside `const [verdict, setVerdict]` add:

```ts
  const [reviewKind, setReviewKind] = useState<"sentiment" | "topic">("sentiment");
  const [topicVerdict, setTopicVerdict] = useState("");
```

Add a second mutation after `review`:

```ts
  const topicReview = useMutation({
    mutationFn: () =>
      submitTopicReview(mode, {
        workspace_id: workspaceId,
        comment_id: reviewing!.id,
        content_hash: reviewing!.content_hash,
        topic_key: topicVerdict,
        reason,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["dashboard-source"] });
      closeReview();
      setReason("");
    },
  });
```

Add `startTopicReview`:

```ts
  function startTopicReview(c: LabelledComment, trigger: HTMLButtonElement) {
    reviewTriggerRef.current = trigger;
    topicReview.reset();
    setReason("");
    setReviewKind("topic");
    setTopicVerdict(c.topic ?? result.data?.topics.find((t) => !t.retired)?.key ?? "");
    setReviewing(c);
  }
```

and in `startReview` add `setReviewKind("sentiment");`. In the actions cell, after the existing correct button, add (only when a taxonomy is active):

```tsx
                            {s.active_topic_key && (
                              <button
                                type="button"
                                onClick={(e) => startTopicReview(c, e.currentTarget)}
                                aria-label={S.correctTopicFor(c.author_name ?? S.purgedAuthor)}
                              >
                                {S.correctTopic}
                              </button>
                            )}
```

In the review `<form>`: its `onSubmit` becomes `(e) => { e.preventDefault(); (reviewKind === "topic" ? topicReview : review).mutate(); }` (match how the existing submit is wired); `aria-label` becomes `reviewKind === "topic" ? S.reviewTopicTitle : S.reviewFormLabel`; the `<h3>` becomes `reviewKind === "topic" ? S.reviewTopicTitle : S.reviewTitle`; the "current" line becomes `reviewKind === "topic" ? S.reviewTopicCurrent(reviewing.topic ? topicName(reviewing.topic) : S.topicNone) : S.reviewCurrent(...)` (keep the existing sentiment branch). Replace the verdict `<select>` label with:

```tsx
                    {reviewKind === "topic" ? (
                      <label>
                        {S.correctTopicLabel}
                        <select
                          aria-label={S.correctTopicLabel}
                          value={topicVerdict}
                          onChange={(e) => setTopicVerdict(e.target.value)}
                        >
                          {(result.data?.topics ?? [])
                            .filter((t) => !t.retired)
                            .map((t) => (
                              <option key={t.key} value={t.key}>
                                {lang === "ar" ? t.name_ar : t.name_en}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : (
                      <label>
                        {S.correctLabel}
                        ...the existing sentiment select, unchanged...
                      </label>
                    )}
```

The error paragraph and the submit button read `(reviewKind === "topic" ? topicReview : review)` for `isError`, `error`, `isPending`; the cancel button resets both.

(f) **Review history.** The history list currently maps `reviewHistory(reviewing)`. Render the topic reviews beneath it, in the same list style, each entry prefixed with `S.reviewKindTopic` and showing `topicName(r.topic_key)`, the reviewer and the reason; prefix the existing entries with `S.reviewKindSentiment`. Reuse `reviewHistory`'s state logic for topic reviews by calling it with `{ reviews: reviewing.topic_reviews.map((r) => ({ ...r, label: r.topic_key as Label })), content_hash: reviewing.content_hash }` — the function only reads `origin`, `content_hash` and `created_at`, so the label cast is inert.

- [ ] **Step 7: Operations page — the third budget**

In `OperationsPanels.tsx`, the budget name becomes:

```tsx
                        {b.event_type === "comment_analysis"
                          ? S.budgetAnalysis
                          : b.event_type === "topic_classification"
                            ? S.budgetTopics
                            : S.budgetBackfill}
```

`planWords.ts` reads only the `comment_analysis` budget for the rail card; leave it.

- [ ] **Step 8: Typecheck, lint, unit tests**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean and green. The `Strings` type will name any key missing from `en.ts`.

- [ ] **Step 9: Append the browser tests**

Append to the end of `tests/e2e/dashboard.spec.ts`:

```ts
// ---- topic classification (2026-09-15) — append-only block ----------------

test("the topics card charts the fixture and counts the unclassified", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("total")).toHaveText("6");
  const card = page.getByTestId("topics-card");
  await card.getByText("عرض الأرقام").click();
  await expect(card.getByRole("row", { name: /إشادة ودعم/ })).toContainText("2");
  await expect(card.getByRole("row", { name: /طلبات واقتراحات/ })).toContainText("1");
  await expect(page.getByTestId("topics-unclassified")).toContainText("1");
});

test("the topic filter narrows the figures, the table and the export together", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByLabel("الموضوع", { exact: true }).selectOption("praise");
  await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
  await expect(page.getByTestId("total")).toHaveText("2");
  await expect(page.locator('[data-testid="comments-table"] tbody tr')).toHaveCount(2);
  const { text } = await downloadCsv(page);
  const lines = text.replace(/^﻿/, "").split("\r\n").filter(Boolean);
  expect(lines).toHaveLength(3);
  const header = lines[0].split(",");
  const i = header.indexOf("effective_topic");
  expect(header.slice(i, i + 3)).toEqual(["effective_topic", "topic_source", "classification_key"]);
  expect(lines[1].split(",")[i]).toBe("praise");
});

test("a topic correction changes the chip and the chart, with a reason", async ({ page }) => {
  await page.goto("/dashboard");
  await page
    .locator('[data-testid="comments-table"] tbody tr')
    .filter({ hasText: "المحتوى واضح ومفيد" })
    .getByRole("button", { name: "تصحيح الموضوع" })
    .click();
  await page.getByLabel("الموضوع الصحيح", { exact: true }).selectOption("question");
  await page.getByLabel("سبب التصحيح").fill("يسأل عن مصدر المعلومة");
  await page.getByRole("button", { name: "حفظ التصحيح" }).click();
  await expect(page.getByRole("form", { name: "تصحيح الموضوع" })).toHaveCount(0);
  const row = page.locator('[data-testid="comments-table"] tbody tr').filter({ hasText: "المحتوى واضح ومفيد" });
  await expect(row.getByTestId("topic-chip")).toContainText("استفسارات وأسئلة");
  await expect(row.getByTestId("topic-chip")).toContainText("مراجعة بشرية");
  const card = page.getByTestId("topics-card");
  await card.getByText("عرض الأرقام").click();
  await expect(card.getByRole("row", { name: /استفسارات وأسئلة/ })).toContainText("2");
});
```

The texts above are the real strings: `figuresShow` is "عرض الأرقام", the apply button is `applyFilters` = "تطبيق الفلاتر", and `correctTopic` / `correctTopicLabel` / `reviewTopicTitle` are the ones added in Step 3. `exact: true` on the labels matters: "الموضوع" is a substring of "الموضوع الصحيح".

- [ ] **Step 10: Run the browser suite**

Run: `npm run test:e2e -- tests/e2e/dashboard.spec.ts`
Expected: PASS, including the three new tests. If the `total` figure differs because the fixture's `by_channel_owner` rows changed, it did not — the fixture edit added fields only; investigate before changing an expectation.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src tests/e2e/dashboard.spec.ts
git commit -m "The Topics card charts real verdicts; the filter, the chip, the export and a correction follow"
```

---

### Task 11: Records, coordination, and the live run

**Files:**
- Modify: `docs/decisions.md`, `docs/progress.md`, `docs/verification.md`, `docs/coordination/ACTIVE.md`

- [ ] **Step 1: Decisions**

Append to `docs/decisions.md` a dated entry: Gemini (`gemini-2.5-flash`, prompt `p1`) is the topic layer; one primary topic per comment from a per-workspace taxonomy of ten seeded defaults; what is sent to Google (comment text, parent text, taxonomy — never author, ids, workspace); why dedicated tables rather than `comment_annotations`; why an `analyse` job rather than a sweep; that the taxonomy-editing screen is deferred; and that the job status for a missing classifier is `blocked`, not the spec's "skipped", because the status vocabulary is fixed.

- [ ] **Step 2: Progress**

Append to `docs/progress.md` a dated entry naming the three migrations, the worker package, the gateway routes, the contracts and dashboard changes, and the commit range.

- [ ] **Step 3: Verification — the live run**

If Task 1 passed, run one `analyse` job against the deployed project:

1. Apply the three migrations to the project (`supabase db push` with the project linked, as previous migrations were applied — check `docs/deployment.md` for the exact command used last time).
2. Deploy the edge function: `supabase functions deploy worker`.
3. Start the worker once with the real credential and the Gemini key:
   ```bash
   set -a; source .env.local; set +a; cd workers/python && uv run --frozen python -m server.loop --model none --topics gemini --max-idle 2
   ```
   The idle tick enqueues the `analyse` job; the loop claims and runs it.
4. Read back: `select status, error_code from jobs where type='analyse' order by created_at desc limit 1;` and `select status, count(*) from topic_predictions group by 1;` and the `topic_classification` line of `usage_summary`.
5. Open the dashboard signed in and confirm the Topics card shows counts.

Record every figure in `docs/verification.md` under the Task 1 heading, labelled live-tested; label everything else in this plan fixture-tested. If Task 1 was refused, record that the live run is blocked on the key's API restriction and stop there.

- [ ] **Step 4: Coordination**

In `docs/coordination/ACTIVE.md`, add a row claiming (dated 2026-09-15) `workers/python/src/topics/**`, `supabase/migrations/20260915160000`–`162000`, `supabase/functions/_shared/worker-gateway.ts`, `supabase/functions/worker/index.ts`, `packages/contracts/src/{topics,comments,filters,snapshot,csv,fixture,usage}.ts`, `apps/web/src/{Dashboard.tsx,data.ts,jobFeed.ts,OperationsPanels.tsx,strings/**,report.css}`, the appended e2e block, and the fixture JSON — and state that nothing of it is uncommitted.

- [ ] **Step 5: The full check**

Run: `npm run check`
Expected: green end to end. `check:secrets` must not find the Gemini key anywhere tracked.

- [ ] **Step 6: Commit**

```bash
git add docs
git commit -m "Record the topic layer: what was decided, what was run, what the live run showed"
```

---

## Self-review

**Spec coverage.** Taxonomy table, seeding, version, active key → Task 2. Predictions, reviews, adoption trigger, append-only, `submit_topic_review`, `set_workspace_topics` → Task 2. Metering kind, `plans.topic_units`, `reserve_usage`, `usage_summary` → Task 2. Snapshot additions → Task 4. `worker_topics_due` (parent text, purged rows as null text, taxonomy, key), `worker_commit_topics` (validation, replay, metering), tick rule → Task 3. Worker package (protocol, Gemini with schema-constrained enum, retries, no URL leakage, deterministic adapter, records) → Tasks 6–7. `run_topics`, gateway client, loop wiring, env documentation → Task 8. Edge routes → Task 9. Contracts (`effectiveTopic`, filter with `__unclassified`, `topic_counts` on filtered rows, CSV columns, fixture) → Task 5. Dashboard card, filter, chip, correction mode, history, Sync job kind and codes, plan line → Task 10. Error table: every code in the table has a producer (Tasks 3, 6, 7, 8) and a string (Task 10). Records and live run → Task 11. Smoke call → Task 1.

**Deviations from the spec, each stated in the task that makes it:** three migration files instead of one; `blocked`+`no_topic_classifier` instead of "skipped"; the tick uses `enqueue_scheduled`'s one-outstanding rule rather than a `topics:<channel>:<version>` dedupe key; `submit_topic_review` writes no `audit_events` row because `submit_comment_review` does not either; the due list adds an `active: false` answer (and the worker a `topic_model_not_active` block) so a worker on the wrong model cannot spend Gemini calls on verdicts that never become effective.

**Type consistency.** `TopicItem(index, text, parent_text, is_reply)` in Tasks 6–7; `TopicVerdict(status, topic_key, confidence, error_code)` positional in tests matches the dataclass order; `classify(classifier, taxonomy, classification_key, rows)` in Tasks 6 and 8; `topics_due(lease, model_id, prompt_version, max_rows)` in Task 8 posts the field names Task 9 reads and Task 3 accepts; the record fields in Task 6 are exactly the columns Task 3's `jsonb_to_recordset` names; `snapshot(..., activeTopicKey)` fifth positional in Tasks 5 and 10; `effectiveTopic` returns `{topic, topic_reviewed}` and `LabelledComment` carries the same names used by the CSV and the dashboard; the filter key is `topics` everywhere; `UNCLASSIFIED` is the string `__unclassified` in the contract and the fixture-mode test.
