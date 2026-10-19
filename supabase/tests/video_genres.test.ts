import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const OWNER_A = "10000000-0000-4000-8000-0000000000a1";
const OWNER_B = "10000000-0000-4000-8000-0000000000b1";
const ADMIN = "10000000-0000-4000-8000-0000000000aa";
const CRED = "a".repeat(64);
const LEASE = "20000000-0000-4000-8000-000000000001";
let db: PGlite;

const as = async (role: "anon" | "authenticated", user = "") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`set role ${role}`);
};

const count = async (sql: string, params: unknown[] = []) =>
  (await db.query<{ n: number }>(sql, params)).rows[0].n;

const record = (overrides: Record<string, unknown> = {}) => ({
  external_video_id: "a-video-1",
  classification_key: "genres:v2+gemini-3.6-flash+g1",
  taxonomy_version: 2,
  status: "succeeded",
  genre_key: "sports_football",
  confidence: 0.9,
  model_id: "gemini-3.6-flash",
  prompt_version: "g1",
  error_code: null,
  ...overrides,
});

describe("video genre classification", () => {
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
      .filter((file) => file.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await db.query("insert into auth.users(id) values ($1),($2),($3)", [
      OWNER_A,
      OWNER_B,
      ADMIN,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'A',$3),($2,'B',$4)",
      [A, B, OWNER_A, OWNER_B],
    );
    await db.query(
      "insert into memberships values ($1,$2,'workspace_owner'),($3,$4,'workspace_owner')",
      [A, OWNER_A, B, OWNER_B],
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
      `insert into channels(id,workspace_id,client_id,external_channel_id,status,catalogued_at)
       values ($1,$1,$1,'UC_A','connected',now()),($2,$2,$2,'UC_B','connected',now())`,
      [A, B],
    );
    await db.query(
      `insert into videos(workspace_id,channel_id,external_video_id,title,published_at)
       values ($1,$1,'a-video-1','Football final',now()),
              ($2,$2,'b-video-1','Other workspace',now())`,
      [A, B],
    );
    await db.query(
      "insert into private.worker_credentials(token_hash,label,workspace_id) values ($1,'genres',$2)",
      [CRED, A],
    );
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      ADMIN,
    ]);
  });

  afterAll(async () => db?.close());

  it("defaults off, schedules nothing, and blocks the due list", async () => {
    await db.query("select private.schedule_due_work($1)", [A]);
    expect(
      await count(
        "select count(*)::int n from jobs where workspace_id=$1 and type='genre_classify'",
        [A],
      ),
    ).toBe(0);
    const job = (
      await db.query<{ id: string }>(
        `insert into jobs(workspace_id,channel_id,type,dedupe_key,status,lease_token,lease_expires_at)
         values ($1,$1,'genre_classify','off','running',$2,now()+interval '1 hour') returning id`,
        [A, LEASE],
      )
    ).rows[0];
    const due = await db.query<{ result: { blocked: string } }>(
      "select public.svc_worker_genres_due($1,$2,$3,'gemini-3.6-flash','g1',50) result",
      [CRED, job.id, LEASE],
    );
    expect(due.rows[0].result).toEqual({
      blocked: "genre_classification_off",
    });
    await db.query("delete from jobs where id=$1", [job.id]);
  });

  it("allows only an admin to change a known switch and audits each change", async () => {
    await as("authenticated", OWNER_A);
    await expect(
      db.query("select public.admin_set_platform_switch($1,$2)", [
        "genre_classification",
        true,
      ]),
    ).rejects.toThrow(/forbidden/);
    await as("authenticated", ADMIN);
    await expect(
      db.query("select public.admin_set_platform_switch('unknown',true)"),
    ).rejects.toThrow(/invalid_input/);
    await db.query(
      "select public.admin_set_platform_switch('genre_classification',true)",
    );
    await db.exec("reset role");
    expect(
      await count(
        "select count(*)::int n from audit_events where action='platform_switch_set' and target_id='genre_classification'",
      ),
    ).toBe(1);
  });

  it("schedules once per day while a recent titled video is pending", async () => {
    const scheduled = await db.query<{ result: { genre_classify: number } }>(
      "select private.schedule_due_work($1) result",
      [A],
    );
    expect(scheduled.rows[0].result.genre_classify).toBe(1);
    await db.query("select private.schedule_due_work($1)", [A]);
    expect(
      await count(
        "select count(*)::int n from jobs where workspace_id=$1 and type='genre_classify'",
        [A],
      ),
    ).toBe(1);
  });

  it("refuses malformed batches whole, replays safely, and never overwrites success", async () => {
    const job = (
      await db.query<{ id: string }>(
        `update jobs set status='running',lease_token=$2,lease_expires_at=now()+interval '1 hour'
          where workspace_id=$1 and type='genre_classify' and status='queued' returning id`,
        [A, LEASE],
      )
    ).rows[0];
    const due = (
      await db.query<{ result: { rows: unknown[]; taxonomy: unknown[] } }>(
        "select public.svc_worker_genres_due($1,$2,$3,'gemini-3.6-flash','g1',99) result",
        [CRED, job.id, LEASE],
      )
    ).rows[0].result;
    expect(due.rows).toHaveLength(1);
    expect(due.taxonomy).toHaveLength(165);

    for (const [name, bad] of [
      ["unknown genre", record({ genre_key: "invented" })],
      ["other version", record({ taxonomy_version: 1 })],
      ["malformed version", record({ taxonomy_version: "two" })],
      [
        "stale key",
        record({ classification_key: "genres:v1+gemini-3.6-flash+g1" }),
      ],
      ["other channel", record({ external_video_id: "b-video-1" })],
      ["success without genre", record({ genre_key: null })],
      ["failed with genre", record({ status: "failed" })],
    ] as const) {
      await expect(
        db.query(
          "select public.svc_worker_commit_genres($1,$2,$3,$4,$5::jsonb)",
          [CRED, job.id, LEASE, name, JSON.stringify([bad])],
        ),
      ).rejects.toThrow(/invalid_batch/);
    }
    expect(
      await count("select count(*)::int n from video_genre_predictions"),
    ).toBe(0);

    const good = JSON.stringify([record()]);
    const first = await db.query<{ result: { stored: number } }>(
      "select public.svc_worker_commit_genres($1,$2,$3,'good',$4::jsonb) result",
      [CRED, job.id, LEASE, good],
    );
    expect(first.rows[0].result.stored).toBe(1);
    const replay = await db.query<{ result: { replayed: boolean } }>(
      "select public.svc_worker_commit_genres($1,$2,$3,'good',$4::jsonb) result",
      [CRED, job.id, LEASE, good],
    );
    expect(replay.rows[0].result.replayed).toBe(true);
    await expect(
      db.query(
        "select public.svc_worker_commit_genres($1,$2,$3,'good',$4::jsonb)",
        [CRED, job.id, LEASE, JSON.stringify([record({ confidence: 0.2 })])],
      ),
    ).rejects.toThrow(/batch_conflict/);
    await db.query(
      "select public.svc_worker_commit_genres($1,$2,$3,'later',$4::jsonb)",
      [
        CRED,
        job.id,
        LEASE,
        JSON.stringify([
          record({ status: "failed", genre_key: null, confidence: null }),
        ]),
      ],
    );
    expect(
      (
        await db.query<{ status: string }>(
          "select status from video_genre_predictions where workspace_id=$1",
          [A],
        )
      ).rows[0].status,
    ).toBe("succeeded");
    await db.query(
      "update jobs set status='succeeded',created_at=now()-interval '25 hours' where id=$1",
      [job.id],
    );
    const complete = await db.query<{ result: { genre_classify: number } }>(
      "select private.schedule_due_work($1) result",
      [A],
    );
    expect(complete.rows[0].result.genre_classify).toBe(0);
  });

  it("enforces tenant reads and refuses authenticated direct writes", async () => {
    await as("authenticated", OWNER_B);
    expect(
      await count(
        "select count(*)::int n from video_genre_predictions where workspace_id=$1",
        [A],
      ),
    ).toBe(0);
    await as("authenticated", OWNER_A);
    expect(
      await count(
        "select count(*)::int n from video_genre_predictions where workspace_id=$1",
        [A],
      ),
    ).toBe(1);
    for (const statement of [
      "insert into video_genre_predictions default values",
      "delete from video_genre_predictions",
      "update video_genre_predictions set confidence=.1",
    ])
      await expect(db.query(statement)).rejects.toThrow(/permission denied/);
  });
});
