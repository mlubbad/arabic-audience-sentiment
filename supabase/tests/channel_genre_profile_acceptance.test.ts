// WO-24 acceptance cases the first two rounds of #181 left untested (PM review,
// 2026-10-19): roll-up arithmetic, view and recency weighting, the Main /
// Primary / Secondary rules, reviews, the switch with rows present, tenant
// isolation, and the recompute timed through the real commit path.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-0000000000a2";
const B = "00000000-0000-4000-8000-0000000000b2";
const OWNER_A = "10000000-0000-4000-8000-0000000000a2";
const ANALYST_A = "10000000-0000-4000-8000-0000000000a3";
const VIEWER_A = "10000000-0000-4000-8000-0000000000a4";
const OWNER_B = "10000000-0000-4000-8000-0000000000b2";
const CRED = "c".repeat(64);
const LEASE = "20000000-0000-4000-8000-0000000000c1";
const KEY = "genres:v2+m+g1";
let db: PGlite;
let channelSeq = 0;

type Profile = {
  blocked?: string;
  source: string | null;
  main: string | null;
  primary: string | null;
  secondary: string[];
  weights: { genre_key: string; level: number; weight: number }[];
  videos: number | null;
  classification_key: string | null;
};

const as = async (role: "authenticated" | "postgres", user = "") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  if (role === "authenticated") await db.exec("set role authenticated");
};

const profile = async (channel: string, user = OWNER_A) => {
  await as("authenticated", user);
  const result = (
    await db.query<{ result: Profile }>(
      "select public.channel_genre_profile($1) result",
      [channel],
    )
  ).rows[0].result;
  await as("postgres");
  return result;
};

const newChannel = async (workspace = A) => {
  channelSeq += 1;
  const id = `30000000-0000-4000-8000-${String(channelSeq).padStart(12, "0")}`;
  await db.query(
    "insert into channels(id,workspace_id,client_id,external_channel_id,status,catalogued_at) values ($1,$2,$2,$3,'connected',now())",
    [id, workspace, `UC_${channelSeq}`],
  );
  return id;
};

type Video = { genre: string; views?: number | null; ageDays?: number | null };

// Inserts the videos and their succeeded predictions, then recomputes.
let videoSeq = 0;
const seed = async (channel: string, videos: Video[], workspace = A) => {
  for (const v of videos) {
    const i = (videoSeq += 1);
    const published =
      v.ageDays === null
        ? null
        : new Date(Date.now() - (v.ageDays ?? 0) * 86_400_000).toISOString();
    const video = (
      await db.query<{ id: string }>(
        `insert into videos(workspace_id,channel_id,external_video_id,title,published_at,view_count)
         values ($1,$2,$3,'t',$4,$5) returning id`,
        [workspace, channel, `${channel}-${i}`, published, v.views ?? null],
      )
    ).rows[0].id;
    await db.query(
      `insert into video_genre_predictions(workspace_id,video_id,classification_key,taxonomy_version,status,genre_key,model_id,prompt_version)
       values ($1,$2,$3,2,'succeeded',$4,'m','g1')`,
      [workspace, video, KEY, v.genre],
    );
  }
  await db.query("select private.refresh_channel_genres($1,$2,$3)", [
    workspace,
    channel,
    KEY,
  ]);
};

const weights = async (channel: string) =>
  Object.fromEntries(
    (
      await db.query<{ genre_key: string; weight: number }>(
        "select genre_key, weight::float weight from channel_genres where channel_id=$1",
        [channel],
      )
    ).rows.map((r) => [r.genre_key, r.weight]),
  );

// Two level-1 genres; under the first, two level-2 genres, the first with a
// level-3 child; under the second, one level-2 genre.
let T: {
  m1: string;
  m2: string;
  p1: string;
  p2: string;
  l1: string;
  q: string;
};

describe("WO-24 acceptance", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const file of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.query("insert into auth.users(id) values ($1),($2),($3),($4)", [
      OWNER_A,
      ANALYST_A,
      VIEWER_A,
      OWNER_B,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'A',$3),($2,'B',$4)",
      [A, B, OWNER_A, OWNER_B],
    );
    await db.query(
      `insert into memberships values ($1,$2,'workspace_owner'),($1,$3,'analyst'),
                                      ($1,$4,'viewer'),($5,$6,'workspace_owner')`,
      [A, OWNER_A, ANALYST_A, VIEWER_A, B, OWNER_B],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'A'),($2,$2,'B')",
      [A, B],
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'pilot','active',now()-interval '1 day',now()+interval '30 days'),
              ($2,'pilot','active',now()-interval '1 day',now()+interval '30 days')`,
      [A, B],
    );
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'genres',$2)",
      [CRED, A],
    );
    await db.query(
      "update private.platform_switches set enabled=true where key='genre_classification'",
    );
    T = (
      await db.query<typeof T>(
        `select m1.key m1, m2.key m2, p1.key p1, p2.key p2, l1.key l1, q.key q
           from genre_taxonomy m1
           join genre_taxonomy p1 on p1.version=2 and p1.parent_key=m1.key and p1.level=2
           join genre_taxonomy l1 on l1.version=2 and l1.parent_key=p1.key and l1.level=3
           join genre_taxonomy p2 on p2.version=2 and p2.parent_key=m1.key and p2.level=2 and p2.key<>p1.key
           join genre_taxonomy m2 on m2.version=2 and m2.level=1 and m2.key<>m1.key
           join genre_taxonomy q on q.version=2 and q.parent_key=m2.key and q.level=2
          where m1.version=2 and m1.level=1
          order by m1.position,p1.position,l1.position,p2.position,m2.position,q.position
          limit 1`,
      )
    ).rows[0];
    expect(T).toBeDefined();
  });
  afterAll(async () => db?.close());

  it("rolls labels up to their ancestors: a worked example checked by hand", async () => {
    const c = await newChannel();
    // Same age and no views, so each video weighs exactly 1.
    await seed(c, [
      { genre: T.l1 },
      { genre: T.p1 },
      { genre: T.p2 },
      { genre: T.m2 },
      { genre: T.q },
    ]);
    const w = await weights(c);
    // Level 1: m1 gets l1, p1, p2 (3 of 5), m2 gets m2, q (2 of 5).
    expect(w[T.m1]).toBeCloseTo(0.6, 4);
    expect(w[T.m2]).toBeCloseTo(0.4, 4);
    // Level 2: p1 gets l1 and p1 (2 of 4); p2 and q one each.
    expect(w[T.p1]).toBeCloseTo(0.5, 4);
    expect(w[T.p2]).toBeCloseTo(0.25, 4);
    expect(w[T.q]).toBeCloseTo(0.25, 4);
    expect(w[T.l1]).toBeCloseTo(1, 4);
    const videos = (
      await db.query<{ videos: number }>(
        "select videos from channel_genres where channel_id=$1 and genre_key=$2",
        [c, T.m1],
      )
    ).rows[0].videos;
    expect(videos).toBe(3);
  });

  it("4 succeeded videos give no profile; 5 give one whose levels each sum to 1", async () => {
    const c = await newChannel();
    await seed(c, [
      { genre: T.l1 },
      { genre: T.p2 },
      { genre: T.m2 },
      { genre: T.q },
    ]);
    expect(Object.keys(await weights(c))).toHaveLength(0);
    expect((await profile(c)).source).toBeNull();
    await seed(c, [{ genre: T.p1 }]);
    const sums = (
      await db.query<{ level: number; total: number }>(
        "select level, sum(weight)::float total from channel_genres where channel_id=$1 group by level",
        [c],
      )
    ).rows;
    expect(sums).toHaveLength(3);
    for (const s of sums)
      expect(Math.abs(s.total - 1)).toBeLessThanOrEqual(0.0001);
  });

  it("views change the Main against video count", async () => {
    const c = await newChannel();
    // m1: 2 videos at 1000 views: (ln 1001 + 1) each, about 7.909.
    // m2: 3 videos with no view count: weight 1 each, not 0.
    await seed(c, [
      { genre: T.m1, views: 1000 },
      { genre: T.m1, views: 1000 },
      { genre: T.m2, views: null },
      { genre: T.m2, views: null },
      { genre: T.m2, views: null },
    ]);
    const heavy = 2 * (Math.log(1001) + 1);
    const w = await weights(c);
    expect(w[T.m1]).toBeCloseTo(heavy / (heavy + 3), 3);
    expect(w[T.m2]).toBeCloseTo(3 / (heavy + 3), 3);
    expect((await profile(c)).main).toBe(T.m1);
  });

  it("recency changes the Main, and a video with no publish date counts at 0.5", async () => {
    const c = await newChannel();
    // m1: 3 videos 180 days old (0.25 each) and one with no date (0.5): 1.25.
    // m2: 2 videos published today: 2.
    await seed(c, [
      { genre: T.m1, ageDays: 180 },
      { genre: T.m1, ageDays: 180 },
      { genre: T.m1, ageDays: 180 },
      { genre: T.m1, ageDays: null },
      { genre: T.m2, ageDays: 0 },
      { genre: T.m2, ageDays: 0 },
    ]);
    const w = await weights(c);
    expect(w[T.m1]).toBeCloseTo(1.25 / 3.25, 3);
    expect(w[T.m2]).toBeCloseTo(2 / 3.25, 3);
    expect((await profile(c)).main).toBe(T.m2);
  });

  it("Main, Primary and Secondary follow the rule, with the 15% cut-off and the tie-break", async () => {
    const c = await newChannel();
    const outside = (
      await db.query<{ key: string }>(
        "select key from genre_taxonomy where version=2 and level=3 and parent_key=$1 order by position limit 1",
        [T.p2],
      )
    ).rows[0]?.key;
    const rows: [string, number, number][] = [
      [T.m1, 1, 0.5],
      [T.m2, 1, 0.5], // a tie: m1 wins on position
      [T.p1, 2, 0.6],
      [T.p2, 2, 0.15], // exactly 15%: Secondary
      [T.q, 2, 0.1499], // just under: not Secondary
      [T.l1, 3, 0.5], // a child of Primary: not Secondary
    ];
    if (outside) rows.push([outside, 3, 0.5]);
    for (const [key, level, weight] of rows)
      await db.query(
        `insert into channel_genres(workspace_id,channel_id,classification_key,taxonomy_version,genre_key,level,weight,videos,computed_at)
         values ($1,$2,$3,2,$4,$5,$6,5,now())`,
        [A, c, KEY, key, level, weight],
      );
    const p = await profile(c);
    expect(p.main).toBe(T.m1);
    expect(p.primary).toBe(T.p1);
    expect(p.secondary).toContain(T.p2);
    expect(p.secondary).not.toContain(T.q);
    expect(p.secondary).not.toContain(T.l1);
    expect(p.secondary).not.toContain(T.p1);
    if (outside) expect(p.secondary).toContain(outside);
  });

  it("a review overrides the labels but not the weights; clearing restores the model's", async () => {
    const c = await newChannel();
    await seed(c, [
      { genre: T.l1 },
      { genre: T.p1 },
      { genre: T.p2 },
      { genre: T.m2 },
      { genre: T.q },
    ]);
    const model = await profile(c);
    expect(model.source).toBe("model");
    await as("authenticated", ANALYST_A);
    await db.query(
      "select public.channel_genre_review_set($1,$2,$3,$4,'owner knows best')",
      [c, T.m2, T.q, [T.p1]],
    );
    await as("postgres");
    const reviewed = await profile(c);
    expect(reviewed.source).toBe("reviewed");
    expect(reviewed.main).toBe(T.m2);
    expect(reviewed.primary).toBe(T.q);
    expect(reviewed.secondary).toEqual([T.p1]);
    expect(reviewed.weights).toEqual(model.weights);
    await as("authenticated", OWNER_A);
    await db.query("select public.channel_genre_review_clear($1)", [c]);
    await as("postgres");
    const cleared = await profile(c);
    expect(cleared.source).toBe("model");
    expect(cleared.main).toBe(model.main);
    expect(cleared.primary).toBe(model.primary);
    expect(cleared.secondary).toEqual(model.secondary);
    const audits = (
      await db.query<{ action: string; n: number }>(
        "select action, count(*)::int n from audit_events where target_id=$1 group by action order by action",
        [c],
      )
    ).rows;
    expect(audits).toEqual([
      { action: "channel_genre_review_clear", n: 1 },
      { action: "channel_genre_review_set", n: 1 },
    ]);
  });

  it("refuses each invalid review, and a viewer or a non-member", async () => {
    const c = await newChannel();
    const call = (user: string, args: unknown[]) =>
      as("authenticated", user).then(() =>
        db.query(
          "select public.channel_genre_review_set($1,$2,$3,$4,$5)",
          args,
        ),
      );
    const level3 = (
      await db.query<{ key: string }>(
        "select key from genre_taxonomy where version=2 and level=3 order by position offset 1 limit 5",
      )
    ).rows.map((r) => r.key);
    for (const args of [
      [c, T.p1, null, [], null], // a level-2 main
      [c, T.m1, T.q, [], null], // a primary that is not a child of main
      [c, "no_such_genre", null, [], null], // an unknown key
      [c, T.m1, T.p1, [T.l1, T.l1], null], // a duplicate secondary
      [c, T.m1, T.p1, [T.p2, T.q, T.l1, ...level3].slice(0, 6), null], // 6
      [c, T.m1, T.p1, [T.m2], null], // a level-1 secondary
      [c, T.m1, null, [], "x".repeat(501)], // reason over 500
    ])
      await expect(call(OWNER_A, args)).rejects.toThrow(/invalid_input/);
    await expect(call(VIEWER_A, [c, T.m1, null, [], null])).rejects.toThrow(
      /forbidden/,
    );
    await expect(call(OWNER_B, [c, T.m1, null, [], null])).rejects.toThrow(
      /forbidden/,
    );
    await as("authenticated", VIEWER_A);
    await expect(
      db.query("select public.channel_genre_review_clear($1)", [c]),
    ).rejects.toThrow(/forbidden/);
    await as("postgres");
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from channel_genre_reviews where channel_id=$1",
          [c],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("with the switch off, rows present give only `blocked`", async () => {
    const c = await newChannel();
    await seed(c, [
      { genre: T.l1 },
      { genre: T.p1 },
      { genre: T.p2 },
      { genre: T.m2 },
      { genre: T.q },
    ]);
    await db.query(
      "update private.platform_switches set enabled=false where key='genre_classification'",
    );
    try {
      expect(await profile(c)).toEqual({ blocked: "genre_classification_off" });
    } finally {
      await as("postgres");
      await db.query(
        "update private.platform_switches set enabled=true where key='genre_classification'",
      );
    }
  });

  it("isolates tenants and refuses direct writes", async () => {
    const c = await newChannel();
    await seed(c, [
      { genre: T.l1 },
      { genre: T.p1 },
      { genre: T.p2 },
      { genre: T.m2 },
      { genre: T.q },
    ]);
    await as("authenticated", OWNER_A);
    await db.query(
      "select public.channel_genre_review_set($1,$2,null,'{}',null)",
      [c, T.m1],
    );
    await as("authenticated", OWNER_B);
    await expect(
      db.query("select public.channel_genre_profile($1)", [c]),
    ).rejects.toThrow(/forbidden/);
    for (const table of ["channel_genres", "channel_genre_reviews"])
      expect(
        (
          await db.query<{ n: number }>(
            `select count(*)::int n from ${table} where channel_id=$1`,
            [c],
          )
        ).rows[0].n,
      ).toBe(0);
    await as("authenticated", OWNER_A);
    await expect(
      db.query(
        `insert into channel_genres(workspace_id,channel_id,classification_key,taxonomy_version,genre_key,level,weight,videos,computed_at)
         values ($1,$2,'x',2,$3,1,1,5,now())`,
        [A, c, T.m1],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        `insert into channel_genre_reviews(workspace_id,channel_id,taxonomy_version,main_key,reviewer_id)
         values ($1,$2,2,$3,$4)`,
        [A, c, T.m1, OWNER_A],
      ),
    ).rejects.toThrow(/permission denied/);
    await as("postgres");
  });

  it("recomputes the profile inside a 50-record commit in under 1 s", async () => {
    const c = await newChannel();
    const genres = [T.l1, T.p1, T.p2, T.m2, T.q];
    const externals: string[] = [];
    for (let i = 0; i < 50; i++) {
      externals.push(`${c}-commit-${i}`);
      await db.query(
        `insert into videos(workspace_id,channel_id,external_video_id,title,published_at,view_count)
         values ($1,$2,$3,'t',now()-($4 || ' days')::interval,$5)`,
        [A, c, externals[i], String(i), i * 10],
      );
    }
    const key = (
      await db.query<{ k: string }>(
        "select private.genre_classification_key(2,'m','g1') k",
      )
    ).rows[0].k;
    const job = (
      await db.query<{ id: string }>(
        `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
         values ($1,$2,'genre_classify','acceptance','running',$3,now()+interval '1 hour') returning id`,
        [A, c, LEASE],
      )
    ).rows[0].id;
    const records = externals.map((external, i) => ({
      external_video_id: external,
      classification_key: key,
      taxonomy_version: 2,
      status: "succeeded",
      genre_key: genres[i % genres.length],
      confidence: 0.9,
      model_id: "m",
      prompt_version: "g1",
      error_code: null,
    }));
    const started = performance.now();
    const result = (
      await db.query<{ result: { stored: number } }>(
        "select public.svc_worker_commit_genres($1,$2,$3,'b1',$4::jsonb) result",
        [CRED, job, LEASE, JSON.stringify(records)],
      )
    ).rows[0].result;
    const elapsed = performance.now() - started;
    expect(result.stored).toBe(50);
    expect(elapsed).toBeLessThan(1000);
    const p = await profile(c);
    expect(p.source).toBe("model");
    expect(p.videos).toBe(50);
  });
});
