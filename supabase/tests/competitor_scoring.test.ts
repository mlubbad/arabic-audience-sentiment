import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const FREE = "00000000-0000-4000-8000-0000000000c1";
const UA = "10000000-0000-4000-8000-0000000000a1";
const UB = "10000000-0000-4000-8000-0000000000b1";
const UV = "10000000-0000-4000-8000-0000000000c1";
const CAND = (n: number) => `UC${n.toString(16).padStart(22, "0")}`;
type SuggestionCandidate = {
  external_id: string;
  status: string | null;
  sources: string[];
  components: {
    content: number | null;
    locale: number | null;
    size: number | null;
  };
  score: number | null;
  tier: string | null;
  reasons: Record<string, unknown>[];
};
const HASH = "a".repeat(64);
let db: PGlite;

async function as(user: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}
async function lease() {
  await db.query(
    "update jobs set status='cancelled' where workspace_id=$1 and type='discover' and status in ('queued','running')",
    [A],
  );
  const { rows } = await db.query<{ id: string; lease_token: string }>(
    `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
     values ($1,$1,'discover',gen_random_uuid()::text,'running',gen_random_uuid(),now()+interval '5 minutes') returning id,lease_token`,
    [A],
  );
  return rows[0]!;
}
async function decide(channel: string, id: string, decision: string) {
  return db.query<{ result: Record<string, unknown> }>(
    "select competitor_decide($1,$2,$3) result",
    [channel, id, decision],
  );
}
async function suggestion(channel = A) {
  const { rows } = await db.query<{ s: Record<string, unknown> }>(
    "select competitor_suggestions($1) s",
    [channel],
  );
  return rows[0]!.s;
}
async function candidate(
  channel: string,
  id: string,
  profile: Record<string, unknown>,
  sources = ["manual"],
) {
  for (const source of sources) {
    await db.query(
      `insert into competitor_candidates(workspace_id,channel_id,candidate_external_id,source,title,subscriber_count,subscriber_count_hidden,view_count,video_count,country,default_language,topic_categories,profile_observed_at)
       values ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())`,
      [
        channel,
        id,
        source,
        profile.title ?? id,
        profile.subscriber_count ?? null,
        profile.subscriber_count_hidden ?? null,
        profile.view_count ?? null,
        profile.video_count ?? null,
        profile.country ?? null,
        profile.default_language ?? null,
        profile.topic_categories ?? null,
      ],
    );
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values ($1),($2),($3)", [
    UA,
    UB,
    UV,
  ]);
  for (const [ws, user, plan] of [
    [A, UA, "creator"],
    [B, UB, "owner"],
    [FREE, UV, "free"],
  ]) {
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'ws',$2)",
      [ws, user],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      ws,
      user,
    ]);
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'client')",
      [ws],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status,platform,subscriber_count,country,default_language,topic_categories) values ($1,$1,$1,$2,'connected','youtube',100,'TR','tr',ARRAY['art','news'])",
      [ws, `UC${ws.slice(-22).replaceAll("-", "a")}`.slice(0, 24)],
    );
    await db.query(
      "insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values ($1,$2,'active',now(),now()+interval '30 days')",
      [ws, plan],
    );
  }
  await db.query("insert into memberships values ($1,$2,'viewer')", [A, UV]);
  await db.query(
    "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'worker',$2)",
    [HASH, A],
  );
  for (let i = 1; i <= 7; i++)
    await candidate(
      A,
      CAND(i),
      {
        title: `cand-${i}`,
        subscriber_count: 100,
        view_count: 1000,
        video_count: 10,
        country: "TR",
        default_language: "tr",
        topic_categories: ["art", "news"],
      },
      i === 1 ? ["manual", "featured"] : ["manual"],
    );
  await candidate(B, CAND(50), { subscriber_count: 10 });
  await db.query(
    "insert into competitor_decisions(workspace_id,channel_id,candidate_external_id,status) values ($1,$1,$2,'tracked')",
    [B, CAND(50)],
  );
  await db.query(
    "insert into competitor_stats_daily(workspace_id,channel_id,candidate_external_id,day,observed_at) values ($1,$1,$2,current_date,now())",
    [B, CAND(50)],
  );
  await candidate(FREE, CAND(60), { subscriber_count: 10 });
});
afterAll(async () => db.close());

describe("competitor scoring and tracking", () => {
  it("enforces tenant access, viewer read access and direct table RLS", async () => {
    await db.exec("reset role");
    await as(UB);
    await expect(suggestion(A)).rejects.toThrow(/forbidden/);
    await expect(decide(A, CAND(1), "tracked")).rejects.toThrow(/forbidden/);
    expect(
      (
        await db.query(
          "select * from competitor_decisions where workspace_id=$1",
          [A],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select * from competitor_stats_daily where workspace_id=$1",
          [A],
        )
      ).rows,
    ).toHaveLength(0);
    await as(UV);
    expect((await suggestion(A)).candidates).toBeTruthy();
    await expect(decide(A, CAND(1), "tracked")).rejects.toThrow(/forbidden/);
  });

  it("enforces plan limits, idempotent tracking and unlimited owner plan", async () => {
    await as(UA);
    for (let i = 1; i <= 3; i++) await decide(A, CAND(i), "tracked");
    await decide(A, CAND(1), "tracked");
    await expect(decide(A, CAND(4), "tracked")).rejects.toThrow(
      /competitor_limit_reached/,
    );
    await as(UV);
    await expect(decide(FREE, CAND(60), "tracked")).rejects.toThrow(
      /competitor_limit_reached/,
    );
    await db.exec("reset role");
    for (let i = 70; i < 105; i++)
      await candidate(B, CAND(i), { subscriber_count: 10 });
    await as(UB);
    for (let i = 70; i < 105; i++) {
      await decide(B, CAND(i), "tracked");
    }
    expect((await suggestion(B)).tracked_count).toBe(36);
  });

  it("scores Jaccard, locale and log-size with null-weight redistribution", async () => {
    await db.exec("reset role");
    await db.query(
      "update channels set subscriber_count=100,topic_categories=ARRAY['a','b','c'],country='TR',default_language='tr' where id=$1",
      [A],
    );
    await candidate(A, CAND(110), {
      subscriber_count: 400,
      view_count: 4,
      video_count: 2,
      country: "TR",
      default_language: "tr",
      topic_categories: ["a", "b", "x"],
    });
    await candidate(A, CAND(111), {
      subscriber_count: 1000,
      topic_categories: ["a", "b", "x"],
    });
    await candidate(A, CAND(112), {
      subscriber_count: 1000,
      subscriber_count_hidden: true,
      topic_categories: null,
      country: null,
      default_language: null,
    });
    await candidate(A, CAND(113), {
      subscriber_count: null,
      topic_categories: null,
      country: null,
      default_language: null,
    });
    await as(UA);
    const rows = (await suggestion()).candidates as SuggestionCandidate[];
    const full = rows.find((x) => x.external_id === CAND(110))!;
    expect(full.components.content).toBe(0.5);
    expect(full.components.locale).toBe(1);
    expect(full.components.size).toBeCloseTo(0.699, 3);
    expect(full.score).toBe(0.675);
    expect(full.tier).toBe("direct");
    const redistributed = rows.find((x) => x.external_id === CAND(111))!;
    expect(redistributed.components).toEqual({
      content: 0.5,
      locale: null,
      size: 0.5,
    });
    expect(redistributed.score).toBe(0.5);
    const allNull = rows.find((x) => x.external_id === CAND(113))!;
    expect(allNull.score).toBeNull();
    expect(allNull.tier).toBeNull();
    expect(
      rows.find((x) => x.external_id === CAND(112))!.components.size,
    ).toBeNull();
    expect(full.reasons).toContainEqual({ kind: "shared_topics", value: 2 });
    expect(full.reasons).toContainEqual({ kind: "same_language" });
    expect(full.reasons).toContainEqual({ kind: "same_country" });
  });

  it("classifies aspirational, direct, indirect and related tier boundaries", async () => {
    await db.exec("reset role");
    await db.query(
      "update channels set subscriber_count=100,topic_categories=ARRAY['a','b','c','d','e','f','g','h','i','j'] where id=$1",
      [A],
    );
    await candidate(A, CAND(120), {
      subscriber_count: 1000,
      topic_categories: ["a", "b", "c"],
    });
    await candidate(A, CAND(121), {
      subscriber_count: 25,
      topic_categories: ["a", "b", "c", "d", "e"],
    });
    await candidate(A, CAND(122), {
      subscriber_count: 500,
      topic_categories: ["a", "b"],
    });
    await candidate(A, CAND(123), {
      subscriber_count: 500,
      topic_categories: ["a"],
    });
    await as(UA);
    const rows = (await suggestion()).candidates as SuggestionCandidate[];
    expect(rows.find((x) => x.external_id === CAND(120))!.tier).toBe(
      "aspirational",
    );
    expect(rows.find((x) => x.external_id === CAND(121))!.tier).toBe("direct");
    expect(rows.find((x) => x.external_id === CAND(122))!.tier).toBe(
      "indirect",
    );
    expect(rows.find((x) => x.external_id === CAND(123))!.tier).toBe("related");
  });

  it("dismisses, clears, merges sources and orders tracked candidates first", async () => {
    await as(UA);
    await decide(A, CAND(2), "dismissed");
    let rows = (await suggestion()).candidates as SuggestionCandidate[];
    expect(rows.some((x) => x.external_id === CAND(2))).toBe(false);
    await decide(A, CAND(2), "clear");
    await decide(A, CAND(3), "tracked");
    rows = (await suggestion()).candidates as SuggestionCandidate[];
    expect(rows.filter((x) => x.external_id === CAND(1))).toHaveLength(1);
    expect(rows.findIndex((x) => x.status === "tracked")).toBeLessThan(
      rows.findIndex((x) => x.status === null),
    );
    expect(rows.find((x) => x.external_id === CAND(1))!.sources).toEqual([
      "featured",
      "manual",
    ]);
  });

  it("stores daily history only for complete tracked profiles and purges old history", async () => {
    await db.exec("reset role");
    await db.query("delete from competitor_decisions where workspace_id=$1", [
      A,
    ]);
    await as(UA);
    await decide(A, CAND(5), "tracked");
    await db.exec("reset role");
    const job = await lease();
    await db.exec("reset role");
    const commit = (p: unknown) =>
      db.query(
        "select svc_worker_commit_candidate_profiles($1,$2,$3,$4::jsonb)",
        [HASH, job.id, job.lease_token, JSON.stringify(p)],
      );
    await commit([
      {
        external_channel_id: CAND(5),
        subscriber_count: 20,
        view_count: 30,
        video_count: 4,
      },
    ]);
    await commit([
      {
        external_channel_id: CAND(5),
        subscriber_count: 21,
        view_count: 31,
        video_count: 5,
      },
    ]);
    await commit([
      {
        external_channel_id: CAND(6),
        subscriber_count: 1,
        view_count: 1,
        video_count: 1,
      },
    ]);
    await commit([
      { external_channel_id: CAND(5), subscriber_count: 22, view_count: 32 },
    ]);
    const history = (
      await db.query<{ n: number; subscriber_count: number }>(
        "select count(*)::int n,max(subscriber_count)::int subscriber_count from competitor_stats_daily where workspace_id=$1 and candidate_external_id=$2",
        [A, CAND(5)],
      )
    ).rows[0]!;
    expect(history).toEqual({ n: 1, subscriber_count: 21 });
    expect(
      (
        await db.query(
          "select * from competitor_stats_daily where workspace_id=$1 and candidate_external_id=$2",
          [A, CAND(6)],
        )
      ).rows,
    ).toHaveLength(0);
    await db.query(
      "update competitor_stats_daily set observed_at=now()-interval '31 days' where workspace_id=$1",
      [A],
    );
    const result = (
      await db.query<{ j: { competitor_stats: number } }>(
        "select private.purge_channel_profile('30 days','30 days') j",
      )
    ).rows[0]!.j;
    expect(result.competitor_stats).toBe(1);
    expect(
      (
        await db.query(
          "select * from competitor_stats_daily where workspace_id=$1",
          [A],
        )
      ).rows,
    ).toHaveLength(0);
    await db.query("update jobs set status='cancelled' where id=$1", [job.id]);
  });

  it("schedules tracked profiles after one day before untracked profiles after seven", async () => {
    await db.exec("reset role");
    await db.query("delete from competitor_decisions where workspace_id=$1", [
      A,
    ]);
    await as(UA);
    await decide(A, CAND(4), "tracked");
    await db.exec("reset role");
    const job = await lease();
    await db.query(
      "update competitor_candidates set profile_observed_at=CASE WHEN candidate_external_id=$2 THEN now()-interval '2 days' ELSE now()-interval '8 days' END where workspace_id=$1 and candidate_external_id in ($2,$3)",
      [A, CAND(4), CAND(7)],
    );
    await db.exec("reset role");
    const { rows } = await db.query<{ ids: string[] }>(
      "select svc_worker_candidates_due($1,$2,$3) ids",
      [HASH, job.id, job.lease_token],
    );
    expect(rows[0]!.ids).toContain(CAND(4));
    expect(rows[0]!.ids).not.toContain(CAND(6));
    expect(rows[0]!.ids).toContain(CAND(7));
    expect(rows[0]!.ids.indexOf(CAND(4))).toBeLessThan(
      rows[0]!.ids.indexOf(CAND(7)),
    );
    await db.query("update jobs set status='cancelled' where id=$1", [job.id]);
  });
});
