import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const MEMBER = "10000000-0000-4000-8000-000000000002";
const OWNER = "10000000-0000-4000-8000-000000000003";
const WORKSPACE_A = "20000000-0000-4000-8000-000000000001";
const WORKSPACE_B = "20000000-0000-4000-8000-000000000002";
const YOUTUBE_A = "30000000-0000-4000-8000-000000000001";
const YOUTUBE_B = "30000000-0000-4000-8000-000000000002";
const TELEGRAM = "30000000-0000-4000-8000-000000000003";
const X = "30000000-0000-4000-8000-000000000004";
const TIKTOK = "30000000-0000-4000-8000-000000000005";
const FACEBOOK = "30000000-0000-4000-8000-000000000006";

type PlatformHealth = {
  last_status: string | null;
  last_finished_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_code: string | null;
  runs_24h: number;
  failures_24h: number;
  consecutive_failures: number;
};

type HealthReport = {
  platforms: Record<string, PlatformHealth>;
  sync_24h: { youtube_runs: number };
  billing_webhooks: {
    last_received_at: string | null;
    last_outcome: string | null;
    received_24h: number;
    problems_7d: number;
  };
};

let db: PGlite;
let anchor: Date;

const ago = (hours: number) =>
  new Date(anchor.getTime() - hours * 60 * 60 * 1000).toISOString();

async function as(role: "authenticated" | "anon", sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    sub ?? "",
  ]);
  await db.exec(`set role ${role}`);
}

async function report() {
  await as("authenticated", ADMIN);
  const { rows } = await db.query<{ report: HealthReport }>(
    "select public.admin_services_health() as report",
  );
  return rows[0]!.report;
}

function expectPlatform(
  actual: PlatformHealth,
  expected: PlatformHealth,
): void {
  expect(actual).toMatchObject({
    last_status: expected.last_status,
    last_error_code: expected.last_error_code,
    runs_24h: expected.runs_24h,
    failures_24h: expected.failures_24h,
    consecutive_failures: expected.consecutive_failures,
  });
  for (const key of [
    "last_finished_at",
    "last_success_at",
    "last_failure_at",
  ] as const) {
    if (expected[key] == null) expect(actual[key]).toBeNull();
    else expect(Date.parse(actual[key]!)).toBe(Date.parse(expected[key]));
  }
}

describe("admin service health from existing records", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
      create function public.__pgrst_probe() returns int language sql as 'select 42';
      create function public.__pgrst_probe2(text) returns int language sql as 'select 42';
      create function public.__pgrst_probe2(text, text[]) returns int language sql as 'select 42';`);
    for (const filename of readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      await db.exec(readFileSync(`supabase/migrations/${filename}`, "utf8"));
    }

    await db.exec("reset role");
    anchor = new Date(
      (await db.query<{ now: string }>("select now()::text as now")).rows[0]!
        .now,
    );
    await db.query(
      "insert into auth.users(id,email) values ($1,'admin@example.test'),($2,'member@example.test'),($3,'owner@example.test')",
      [ADMIN, MEMBER, OWNER],
    );
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      ADMIN,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'workspace a',$3),($2,'workspace b',$3)",
      [WORKSPACE_A, WORKSPACE_B, OWNER],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'client a'),($2,$2,'client b')",
      [WORKSPACE_A, WORKSPACE_B],
    );
    await db.query(
      `insert into channels(id,workspace_id,client_id,platform,external_channel_id,status) values
       ($1,$7::uuid,$7::uuid,'youtube','youtube-a','connected'),
       ($2,$8::uuid,$8::uuid,'youtube','youtube-b','connected'),
       ($3,$7::uuid,$7::uuid,'telegram','telegram','connected'),
       ($4,$7::uuid,$7::uuid,'x','x','connected'),
       ($5,$7::uuid,$7::uuid,'tiktok','tiktok','connected'),
       ($6,$7::uuid,$7::uuid,'facebook','facebook','connected')`,
      [
        YOUTUBE_A,
        YOUTUBE_B,
        TELEGRAM,
        X,
        TIKTOK,
        FACEBOOK,
        WORKSPACE_A,
        WORKSPACE_B,
      ],
    );

    await db.query(
      `insert into sync_runs(workspace_id,channel_id,mode,source,started_at,ended_at,status,error_code) values
       ($1,$3,'collect','unknown',$9,$10,'succeeded',null),
       ($2,$4,'discover','unknown',$11,$12,'succeeded',null),
       ($1,$3,'collect','youtube',$13,$14,'succeeded',null),
       ($1,$3,'analyse','unknown',$15,$16,'failed','ignored_mode'),
       ($1,$3,'collect','unknown',$17,null,'running',null),
       ($1,$5,'collect','unknown',$18,$19,'succeeded',null),
       ($1,$5,'collect','unknown',$20,$21,'failed','provider_error'),
       ($1,$6,'collect','unknown',$22,$23,'succeeded',null),
       ($1,$6,'collect','unknown',$24,$25,'failed','one'),
       ($1,$6,'collect','unknown',$26,$27,'blocked','two'),
       ($1,$6,'collect','unknown',$28,$29,'failed','three'),
       ($1,$7,'collect','unknown',$30,$31,'succeeded',null),
       ($1,$8,'collect','unknown',$32,$33,'failed','ignored_platform')`,
      [
        WORKSPACE_A,
        WORKSPACE_B,
        YOUTUBE_A,
        YOUTUBE_B,
        TELEGRAM,
        X,
        TIKTOK,
        FACEBOOK,
        ago(2),
        ago(1.9),
        ago(5),
        ago(4.9),
        ago(192),
        ago(191.9),
        ago(1),
        ago(0.9),
        ago(0.5),
        ago(30),
        ago(29.9),
        ago(2),
        ago(1.9),
        ago(144),
        ago(143.9),
        ago(72),
        ago(71.9),
        ago(48),
        ago(47.9),
        ago(20),
        ago(19.9),
        ago(192),
        ago(191.9),
        ago(1.5),
        ago(1.4),
      ],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("emits all platforms, uses channels.platform, and ignores old, running, and unrelated rows", async () => {
    const initial = await report();
    expect(initial.platforms.tiktok).toEqual({
      last_status: null,
      last_finished_at: null,
      last_success_at: null,
      last_failure_at: null,
      last_error_code: null,
      runs_24h: 0,
      failures_24h: 0,
      consecutive_failures: 0,
    });

    await db.exec("reset role");
    await db.query(
      `insert into sync_runs(workspace_id,channel_id,mode,source,started_at,ended_at,status,error_code)
       values ($1,$2,'collect','unknown',$3,$4,'failed','quota_exceeded')`,
      [WORKSPACE_A, TIKTOK, ago(3), ago(2.9)],
    );

    const result = await report();
    expect(Object.keys(result.platforms).sort()).toEqual([
      "telegram",
      "tiktok",
      "x",
      "youtube",
    ]);
    expectPlatform(result.platforms.youtube, {
      last_status: "succeeded",
      last_finished_at: ago(1.9),
      last_success_at: ago(1.9),
      last_failure_at: null,
      last_error_code: null,
      runs_24h: 2,
      failures_24h: 0,
      consecutive_failures: 0,
    });
    expectPlatform(result.platforms.telegram, {
      last_status: "failed",
      last_finished_at: ago(1.9),
      last_success_at: ago(29.9),
      last_failure_at: ago(1.9),
      last_error_code: "provider_error",
      runs_24h: 1,
      failures_24h: 1,
      consecutive_failures: 1,
    });
    expectPlatform(result.platforms.x, {
      last_status: "failed",
      last_finished_at: ago(19.9),
      last_success_at: ago(143.9),
      last_failure_at: ago(19.9),
      last_error_code: "three",
      runs_24h: 1,
      failures_24h: 1,
      consecutive_failures: 3,
    });
    expectPlatform(result.platforms.tiktok, {
      last_status: "failed",
      last_finished_at: ago(2.9),
      last_success_at: null,
      last_failure_at: ago(2.9),
      last_error_code: "quota_exceeded",
      runs_24h: 1,
      failures_24h: 1,
      consecutive_failures: 1,
    });
    expect(result.sync_24h.youtube_runs).toBe(4);

    const serialized = JSON.stringify(result.platforms);
    expect(serialized).not.toContain(WORKSPACE_A);
    expect(serialized).not.toContain(WORKSPACE_B);
    expect(serialized).not.toContain(YOUTUBE_A);
    expect(serialized).not.toContain("payload");
  });

  it("summarizes billing outcomes without exposing event data", async () => {
    expect((await report()).billing_webhooks).toEqual({
      last_received_at: null,
      last_outcome: null,
      received_24h: 0,
      problems_7d: 0,
    });

    await db.exec("reset role");
    await db.query(
      `insert into private.billing_events(event_id,event_type,occurred_at,workspace_id,applied_at,outcome,payload) values
       ('evt_applied','subscription.updated',$1,$4,$1,'applied','{"secret":"not returned"}'),
       ('evt_unmapped','subscription.updated',$2,null,$2,'unmapped','{}'),
       ('evt_conflict','subscription.updated',$3,$4,$3,'conflict','{}')`,
      [ago(48), ago(12), ago(1), WORKSPACE_A],
    );
    const billing = (await report()).billing_webhooks;
    expect(billing).toMatchObject({
      last_outcome: "conflict",
      received_24h: 2,
      problems_7d: 2,
    });
    expect(Date.parse(billing.last_received_at!)).toBe(Date.parse(ago(1)));
    expect(JSON.stringify(billing)).not.toContain("event_id");
    expect(JSON.stringify(billing)).not.toContain("secret");
    expect(JSON.stringify(billing)).not.toContain(WORKSPACE_A);
  });

  it("refuses a non-admin and anon", async () => {
    await as("authenticated", MEMBER);
    await expect(
      db.query("select public.admin_services_health()"),
    ).rejects.toThrow(/forbidden/);
    await as("anon", null);
    await expect(
      db.query("select public.admin_services_health()"),
    ).rejects.toThrow(/permission denied/i);
  });
});
