import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
let db: PGlite;
async function as(user: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}
const A = "00000000-0000-4000-8000-0000000000a1",
  B = "00000000-0000-4000-8000-0000000000b1";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  const UA = "10000000-0000-4000-8000-0000000000a1",
    UB = "10000000-0000-4000-8000-0000000000b1",
    UV = "10000000-0000-4000-8000-0000000000c1";
  await db.query("insert into auth.users(id) values ($1),($2),($3)", [
    UA,
    UB,
    UV,
  ]);
  for (const [ws, user, plan] of [
    [A, UA, "creator"],
    [B, UB, "owner"],
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
      "insert into channels(id,workspace_id,client_id,external_channel_id,status,platform,title) values ($1,$1,$1,$2,'connected','youtube',$3)",
      [ws, ws === A ? "UCA" : "UCB", ws === A ? "Own" : "Other"],
    );
    await db.query(
      "insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values ($1,$2,'active',now(),now()+interval '30 days')",
      [ws, plan],
    );
  }
  await db.query("insert into memberships values ($1,$2,'viewer')", [A, UV]);
  await db.query(
    "insert into competitor_candidates(workspace_id,channel_id,candidate_external_id,source,title) values ($1,$1,'UC0000000000000000000001','manual','Tracked'),($1,$1,'UC0000000000000000000001','featured','Tracked feature'),($1,$1,'UC0000000000000000000002','manual','Dismissed')",
    [A],
  );
  await db.query(
    "insert into competitor_decisions(workspace_id,channel_id,candidate_external_id,status) values ($1,$1,'UC0000000000000000000001','tracked'),($1,$1,'UC0000000000000000000002','dismissed')",
    [A],
  );
  await db.query(
    "insert into channel_stats_daily(workspace_id,channel_id,day,subscriber_count,view_count,video_count,observed_at) values ($1,$1,current_date-8,10,100,4,now()),($1,$1,current_date,20,180,2,now())",
    [A],
  );
  await db.query(
    "insert into competitor_stats_daily(workspace_id,channel_id,candidate_external_id,day,subscriber_count,view_count,video_count,observed_at) values ($1,$1,'UC0000000000000000000001',current_date,30,90,0,now())",
    [A],
  );
});
afterAll(async () => db.close());
describe("competitor_benchmark", () => {
  it("computes changes, retains negative video delta, and omits untracked candidates", async () => {
    await as("10000000-0000-4000-8000-0000000000a1");
    type Result = {
      series: {
        external_id: string;
        points: { day: string }[];
        kpis: Record<string, number | null>;
      }[];
    };
    const { rows } = await db.query<{ b: Result }>(
      "select competitor_benchmark($1,30) b",
      [A],
    );
    const series = rows[0]!.b.series;
    expect(series.map((x) => x.external_id)).toEqual([
      "UCA",
      "UC0000000000000000000001",
    ]);
    expect(series[1]!.points).toHaveLength(1);
    expect(series[0]!.points.map((point) => point.day)).toEqual([
      expect.any(String),
      expect.any(String),
    ]);
    expect(series[0].kpis).toMatchObject({
      subscribers_change: 10,
      views_change: 80,
      videos_per_week: -1.75,
      views_per_video: 90,
    });
    expect(series[1].kpis).toMatchObject({
      subscribers_change: null,
      views_per_video: null,
      videos_per_week: null,
    });
  });
  it("rejects invalid windows and another workspace", async () => {
    await as("10000000-0000-4000-8000-0000000000a1");
    await expect(
      db.query("select competitor_benchmark($1,1095)", [A]),
    ).resolves.toBeTruthy();
    await expect(
      db.query("select competitor_benchmark($1,1096)", [A]),
    ).rejects.toThrow("invalid_input");
    await expect(
      db.query("select competitor_benchmark($1,6)", [A]),
    ).rejects.toThrow("invalid_input");
    await expect(
      db.query("select competitor_benchmark($1,30)", [B]),
    ).rejects.toThrow("forbidden");
  });
  it("bounds the date window and returns only tracked candidates for this channel", async () => {
    await db.exec("reset role");
    const otherChannel = "00000000-0000-4000-8000-0000000000a4";
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status,platform,title) values ($1,$2,$2,'UCA4','connected','youtube','Other workspace channel')",
      [otherChannel, A],
    );
    await db.query(
      "insert into competitor_candidates(workspace_id,channel_id,candidate_external_id,source,title) values ($1,$2,'UC0000000000000000000009','manual','Other channel')",
      [A, otherChannel],
    );
    await db.query(
      "insert into competitor_decisions(workspace_id,channel_id,candidate_external_id,status) values ($1,$2,'UC0000000000000000000009','tracked')",
      [A, otherChannel],
    );
    await db.query(
      "insert into competitor_candidates(workspace_id,channel_id,candidate_external_id,source,title) values ($1,$1,'UC0000000000000000000003','manual','No decision'),($1,$1,'UC0000000000000000000004','manual','Clear'),($1,$1,'UC0000000000000000000005','manual','No stats')",
      [A],
    );
    await db.query(
      "insert into competitor_decisions(workspace_id,channel_id,candidate_external_id,status) values ($1,$1,'UC0000000000000000000004','tracked'),($1,$1,'UC0000000000000000000005','tracked')",
      [A],
    );
    // A clear deletes the decision row; it is never stored as a status.
    await as("10000000-0000-4000-8000-0000000000a1");
    await db.query(
      "select competitor_decide($1,'UC0000000000000000000004','clear')",
      [A],
    );
    await db.exec("reset role");
    await db.query(
      "insert into competitor_stats_daily(workspace_id,channel_id,candidate_external_id,day,subscriber_count,view_count,video_count,observed_at) values ($1,$1,'UC0000000000000000000001',current_date-40,999,999,99,now())",
      [A],
    );
    await as("10000000-0000-4000-8000-0000000000a1");
    const { rows } = await db.query<{
      b: {
        series: {
          external_id: string;
          points: unknown[];
          kpis: Record<string, number | null>;
        }[];
      };
    }>("select competitor_benchmark($1,30) b", [A]);
    expect(rows[0]!.b.series.map((s) => s.external_id)).toEqual([
      "UCA",
      "UC0000000000000000000001",
      "UC0000000000000000000005",
    ]);
    expect(rows[0]!.b.series[1]!.points).toHaveLength(1);
    expect(rows[0]!.b.series[2]).toMatchObject({
      points: [],
      kpis: {
        subscribers: null,
        views: null,
        subscribers_change: null,
        views_change: null,
        videos_per_week: null,
        views_per_video: null,
      },
    });
  });
  it("keeps an own channel without stats first and orders competitors by latest subscribers", async () => {
    await db.exec("reset role");
    const own2 = "00000000-0000-4000-8000-0000000000a2";
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status,platform,title) values ($1,$2,$2,'UCA2','connected','youtube','Own no stats')",
      [own2, A],
    );
    await db.query(
      "insert into competitor_candidates(workspace_id,channel_id,candidate_external_id,source,title) values ($1,$2,'UC0000000000000000000006','manual','Low'),($1,$2,'UC0000000000000000000007','manual','High'),($1,$2,'UC0000000000000000000008','manual','Null')",
      [A, own2],
    );
    await db.query(
      "insert into competitor_decisions(workspace_id,channel_id,candidate_external_id,status) values ($1,$2,'UC0000000000000000000006','tracked'),($1,$2,'UC0000000000000000000007','tracked'),($1,$2,'UC0000000000000000000008','tracked')",
      [A, own2],
    );
    await db.query(
      "insert into competitor_stats_daily(workspace_id,channel_id,candidate_external_id,day,subscriber_count,view_count,video_count,observed_at) values ($1,$2,'UC0000000000000000000006',current_date,50,1,1,now()),($1,$2,'UC0000000000000000000007',current_date,500,1,1,now()),($1,$2,'UC0000000000000000000008',current_date,null,1,1,now())",
      [A, own2],
    );
    await as("10000000-0000-4000-8000-0000000000a1");
    const { rows } = await db.query<{
      b: {
        series: {
          external_id: string;
          points: unknown[];
          kpis: Record<string, number | null>;
        }[];
      };
    }>("select competitor_benchmark($1,30) b", [own2]);
    expect(rows[0]!.b.series.map((s) => s.external_id)).toEqual([
      "UCA2",
      "UC0000000000000000000007",
      "UC0000000000000000000006",
      "UC0000000000000000000008",
    ]);
    expect(rows[0]!.b.series[0]).toMatchObject({
      points: [],
      kpis: {
        subscribers: null,
        views: null,
        subscribers_change: null,
        views_change: null,
        videos_per_week: null,
        views_per_video: null,
      },
    });
  });
  it("computes changes across three days but leaves videos per week unknown", async () => {
    await db.exec("reset role");
    const own3 = "00000000-0000-4000-8000-0000000000a3";
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,status,platform,title) values ($1,$2,$2,'UCA3','connected','youtube','Own three days')",
      [own3, A],
    );
    await db.query(
      "insert into channel_stats_daily(workspace_id,channel_id,day,subscriber_count,view_count,video_count,observed_at) values ($1,$2,current_date-3,10,20,4,now()),($1,$2,current_date,15,35,5,now())",
      [A, own3],
    );
    await as("10000000-0000-4000-8000-0000000000a1");
    const { rows } = await db.query<{
      b: { series: { kpis: Record<string, number | null> }[] };
    }>("select competitor_benchmark($1,30) b", [own3]);
    expect(rows[0]!.b.series[0]!.kpis).toMatchObject({
      subscribers_change: 5,
      views_change: 15,
      videos_per_week: null,
    });
  });
  it("allows workspace viewers and denies anon execution", async () => {
    await as("10000000-0000-4000-8000-0000000000c1");
    await expect(
      db.query("select competitor_benchmark($1,30)", [A]),
    ).resolves.toBeTruthy();
    await db.exec("reset role; set role anon");
    await expect(
      db.query("select competitor_benchmark($1,30)", [A]),
    ).rejects.toThrow(/permission denied/i);
  });
});
