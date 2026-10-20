import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const W1 = "00000000-0000-4000-8000-0000000000a1";
const W2 = "00000000-0000-4000-8000-0000000000b1";
const U1 = "10000000-0000-4000-8000-0000000000a1";
const U2 = "10000000-0000-4000-8000-0000000000b1";
const A = "20000000-0000-4000-8000-0000000000a1";
const B = "20000000-0000-4000-8000-0000000000a2";
const C = "20000000-0000-4000-8000-0000000000b1";
const OTHER_PLATFORM = "20000000-0000-4000-8000-0000000000a3";
// Mutation targets in the migration: gates 16, 19, 22, 27, 30; thresholds 46;
// bot filters 53, 60, 67; privacy floor 82; affinity tie-break 70; B-only scope 58, 66 (mutate both together).
// UUID order intentionally conflicts with affinity so removing line 70 fails this assertion.
const V1 = "30000000-0000-4000-8000-0000000000a2";
const V2 = "30000000-0000-4000-8000-0000000000a1";
const V3 = "30000000-0000-4000-8000-0000000000a3";
const VA = "30000000-0000-4000-8000-0000000000a4";
let db: PGlite;

const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};
const call = (channel = A, other = B, limit = 10) =>
  db.query("select public.audience_shared_videos($1,$2,$3)", [
    channel,
    other,
    limit,
  ]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [U1, U2]);
  for (const [w, u] of [
    [W1, U1],
    [W2, U2],
  ]) {
    await db.query(
      "insert into workspaces(id,name,created_by) values($1,'workspace',$2)",
      [w, u],
    );
    await db.query(
      "insert into memberships(workspace_id,user_id,role) values($1,$2,'workspace_owner')",
      [w, u],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values($1,$1,'client')",
      [w],
    );
  }
  for (const [id, w, external] of [
    [A, W1, "UC_a"],
    [B, W1, "UC_b"],
    [C, W2, "UC_c"],
  ])
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,title) values($1,$2,$2,$3,$3)",
      [id, w, external],
    );
  await db.query(
    "alter table public.channels drop constraint channels_platform_check",
  );
  await db.query(
    "insert into channels(id,workspace_id,client_id,external_channel_id,title,platform) values($1,$2,$2,'IG_x','Instagram','instagram')",
    [OTHER_PLATFORM, W1],
  );
  for (const [w, plan] of [
    [W1, "agency"],
    [W2, "agency"],
  ])
    await db.query(
      "insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values($1,$2,'active',now()-interval '1 day',now()+interval '30 days')",
      [w, plan],
    );
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec("reset role");
  await db.exec(
    "truncate private.audience_member_videos,private.audience_members,private.audience_overlap_cells,private.audience_sizes",
  );
  await db.query(
    "update private.platform_switches set enabled=false where key='audience_overlap'",
  );
  await db.query(
    "update subscriptions set plan_key='agency' where workspace_id in ($1,$2)",
    [W1, W2],
  );
});

describe("audience_shared_videos", () => {
  it("applies the feature gates before validating the pair", async () => {
    await as(U1);
    await expect(call(A, C)).rejects.toThrow(/feature_unavailable/);
    await db.exec("reset role");
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    await db.query(
      "update subscriptions set plan_key='creator' where workspace_id=$1",
      [W1],
    );
    await as(U1);
    await expect(call(A, C)).rejects.toThrow(/plan_feature_unavailable/);
    await db.exec("reset role");
    await db.query(
      "update subscriptions set plan_key='agency' where workspace_id=$1",
      [W1],
    );
    await as(U1);
    await expect(call(A, C)).rejects.toThrow(/invalid_input/);
    await expect(call(A, OTHER_PLATFORM)).rejects.toThrow(/invalid_input/);
    await expect(call(A, B, 0)).rejects.toThrow(/invalid_input/);
    await expect(call(A, B, 51)).rejects.toThrow(/invalid_input/);
    await expect(call(C, B)).rejects.toThrow(/forbidden/);
    await db.exec("reset role; set role anon");
    await expect(call()).rejects.toThrow();
  });

  it("returns no videos below pair thresholds", async () => {
    await db.query(
      "insert into private.audience_sizes values($1,$2,'youtube',99,now()),($1,$3,'youtube',100,now())",
      [W1, A, B],
    );
    await db.query(
      "insert into private.audience_overlap_cells values($1,$2,$3,99,100,20,now())",
      [W1, A, B],
    );
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    await as(U1);
    expect((await call()).rows[0]).toMatchObject({
      audience_shared_videos: { status: "below_threshold", videos: [] },
    });
    await db.exec("reset role");
    await db.query(
      "update private.audience_sizes set size=100 where workspace_id=$1",
      [W1],
    );
    await db.exec("reset role");
    await db.query(
      "update private.audience_overlap_cells set a_size=100,shared=9 where workspace_id=$1",
      [W1],
    );
    await as(U1);
    expect((await call()).rows[0]).toMatchObject({
      audience_shared_videos: { status: "below_threshold", videos: [] },
    });
  });

  it("counts distinct non-bots, applies the privacy floor, affinity ordering, and returns only B videos", async () => {
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    await db.query(
      "insert into private.audience_sizes values($1,$2,'youtube',100,now()),($1,$3,'youtube',100,now())",
      [W1, A, B],
    );
    await db.query(
      "insert into private.audience_overlap_cells values($1,$2,$3,100,100,20,now())",
      [W1, A, B],
    );
    await db.query(
      `insert into public.videos(id,workspace_id,channel_id,external_video_id,title,published_at)
      values($1,$2,$3,'b1','Bridge 1','2026-01-01T00:00:00Z'),($4,$2,$3,'b2','Bridge 2','2026-01-02T00:00:00Z'),($5,$2,$3,'b3','Private floor','2026-01-03T00:00:00Z'),($6,$2,$7,'a1','A only','2026-01-04T00:00:00Z')`,
      [V1, W1, B, V2, V3, VA, A],
    );
    for (let i = 1; i <= 20; i++) {
      await db.query(
        "insert into private.audience_members values($1,$2,decode(lpad(to_hex($3::int),64,'0'),'hex'),now(),now(),1,false)",
        [W1, A, i],
      );
    }
    await db.query(
      "insert into private.audience_members values($1,$2,decode(lpad(to_hex(2000::int),64,'0'),'hex'),now(),now(),1,true),($1,$2,decode(lpad(to_hex(3000::int),64,'0'),'hex'),now(),now(),1,false)",
      [W1, A],
    );
    for (let i = 1; i <= 6; i++) {
      await db.query(
        "insert into private.audience_members values($1,$2,decode(lpad(to_hex($3::int),64,'0'),'hex'),now(),now(),1,false)",
        [W1, B, i],
      );
    }
    for (let i = 1001; i <= 1014; i++)
      await db.query(
        "insert into private.audience_members values($1,$2,decode(lpad(to_hex($3::int),64,'0'),'hex'),now(),now(),1,false)",
        [W1, B, i],
      );
    await db.query(
      "insert into private.audience_members values($1,$2,decode(lpad(to_hex(2000::int),64,'0'),'hex'),now(),now(),1,false),($1,$2,decode(lpad(to_hex(3000::int),64,'0'),'hex'),now(),now(),1,true)",
      [W1, B],
    );
    for (const [video, count] of [
      [V1, 3],
      [V2, 13],
      [V3, 0],
    ] as const) {
      for (let i = 1; i <= (video === V3 ? 4 : 6); i++)
        await db.query(
          "insert into private.audience_member_videos values($1,$2,decode(lpad(to_hex($3::int),64,'0'),'hex'),1,now(),now())",
          [W1, video, i],
        );
      for (let i = 0; i < count; i++)
        await db.query(
          "insert into private.audience_member_videos values($1,$2,decode(lpad(to_hex($3::int),64,'0'),'hex'),1,now(),now())",
          [W1, video, 1001 + i],
        );
      if (video !== V3)
        await db.query(
          "insert into private.audience_member_videos values($1,$2,decode(lpad(to_hex(2000::int),64,'0'),'hex'),1,now(),now()),($1,$2,decode(lpad(to_hex(3000::int),64,'0'),'hex'),1,now(),now())",
          [W1, video],
        );
    }
    for (let i = 1; i <= 6; i++)
      await db.query(
        "insert into private.audience_member_videos values($1,$2,decode(lpad(to_hex($3::int),64,'0'),'hex'),1,now(),now())",
        [W1, VA, i],
      );
    await as(U1);
    const rows = ((await call()).rows[0] as Record<string, unknown>)
      .audience_shared_videos as {
      status: string;
      videos: Array<Record<string, unknown>>;
    };
    expect(rows.status).toBe("ready");
    expect(rows.videos.map((v) => v.video_id)).toEqual([V1, V2]);
    expect(rows.videos[0]).toMatchObject({
      external_video_id: "b1",
      title: "Bridge 1",
      published_at: "2026-01-01T03:00:00+03:00",
      shared_commenters: 6,
      video_audience: 10,
      affinity: 300,
    });
    expect(rows.videos[1]).toMatchObject({
      external_video_id: "b2",
      shared_commenters: 6,
      video_audience: 20,
      affinity: 150,
    });
    expect(Object.keys(rows.videos[0]).sort()).toEqual(
      [
        "video_id",
        "external_video_id",
        "title",
        "published_at",
        "shared_commenters",
        "video_audience",
        "affinity",
      ].sort(),
    );
    expect(JSON.stringify(rows)).not.toMatch(/member_hash|comment_id|text_raw/);
  });
});
