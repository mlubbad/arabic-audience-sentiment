import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000001";
const ADMIN = "20000000-0000-4000-8000-000000000001";
const WORKER_TOKEN = "e".repeat(64);

let db: PGlite;

describe("Unlimited plans overflow protection and worker retry lifecycle", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
    `);

    for (const f of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    }

    await db.query("insert into auth.users(id) values ($1), ($2)", [
      OWNER,
      ADMIN,
    ]);
    await db.query(
      "insert into workspaces(id, name, created_by) values ($1, 'Test WS', $2)",
      [W, OWNER],
    );
    await db.query(
      "insert into memberships(workspace_id, user_id, role) values ($1, $2, 'workspace_owner')",
      [W, OWNER],
    );
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      ADMIN,
    ]);
    await db.query(
      "insert into private.worker_credentials(token_hash, label, workspace_id) values ($1, 'test-worker', $2)",
      [WORKER_TOKEN, W],
    );
    await db.query(
      "insert into subscriptions(workspace_id, plan_key, status, period_start, period_end) values ($1, 'owner', 'active', now() - interval '1 day', now() + interval '29 days')",
      [W],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  const asUser = async (userId: string) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      userId,
    ]);
  };

  const asAdmin = async () => asUser(ADMIN);
  const asServiceRole = async () => {
    await db.exec("reset role; set role service_role");
  };

  interface UpdatePlanResult {
    ok: boolean;
    plan: {
      limits: {
        analysis_units: number;
        topic_units: number;
        channels: number;
        members: number;
        workspaces: number;
      };
      backfill_units: number;
      historical_days_limit: number;
    };
  }

  interface BudgetEntryResult {
    event_type: string;
    allowance: number;
    granted: number;
    used: number;
    remaining: number;
  }

  interface WorkerTopicsDueResult {
    blocked?: string;
    active: boolean;
    rows: unknown[];
    taxonomy: unknown[];
  }

  describe("Unlimited-plan NULL limits and bigint arithmetic", () => {
    it("persists NULL in public.plans for historical_days_limit when -1 is passed via update_plan_limits for a non-internal plan (creator)", async () => {
      await asServiceRole();
      // Creator starts with finite historical_days_limit = 30
      const initial = await db.query<{ historical_days_limit: number | null }>(
        "select historical_days_limit from public.plans where key = 'creator'",
      );
      expect(initial.rows[0].historical_days_limit).toBe(30);

      await asAdmin();
      const res = await db.query<{ update_plan_limits: UpdatePlanResult }>(
        `select public.update_plan_limits('creator', jsonb_build_object(
          'historical_days_limit', -1
        )) as update_plan_limits`,
      );

      const parsed = res.rows[0].update_plan_limits;
      expect(parsed.ok).toBe(true);
      expect(parsed.plan.historical_days_limit).toBe(-1);

      // Verify the underlying table has true NULL, not -1
      await asServiceRole();
      const check = await db.query<{
        historical_days_limit: number | null;
      }>(
        "select historical_days_limit from public.plans where key = 'creator'",
      );
      expect(check.rows[0].historical_days_limit).toBeNull();

      // And verify updating back to a positive integer persists the integer
      await asAdmin();
      await db.query(
        `select public.update_plan_limits('creator', jsonb_build_object(
          'historical_days_limit', 45
        ))`,
      );
      await asServiceRole();
      const restored = await db.query<{ historical_days_limit: number | null }>(
        "select historical_days_limit from public.plans where key = 'creator'",
      );
      expect(restored.rows[0].historical_days_limit).toBe(45);
    });

    it("budget_entry formats unlimited as -1 without 32-bit integer overflow", async () => {
      await asServiceRole();
      // Null allowance returns -1 allowance and -1 remaining
      const nullRes = await db.query<{ budget_entry: BudgetEntryResult }>(
        "select private.budget_entry('comment_analysis', null, 50, 0) as budget_entry",
      );
      expect(nullRes.rows[0].budget_entry).toEqual({
        event_type: "comment_analysis",
        allowance: -1,
        granted: 0,
        used: 50,
        remaining: -1,
      });

      // 64-bit bigint numbers (> 2^31 - 1 = 2147483647) do not overflow
      const bigRes = await db.query<{ budget_entry: BudgetEntryResult }>(
        "select private.budget_entry('comment_analysis', 3000000000::bigint, 1000000000::bigint, 500000000::bigint) as budget_entry",
      );
      expect(bigRes.rows[0].budget_entry).toEqual({
        event_type: "comment_analysis",
        allowance: 3500000000,
        granted: 500000000,
        used: 1000000000,
        remaining: 2500000000,
      });
    });

    it("analysis_remaining, topic_units_remaining, and backfill_remaining return NULL on unlimited plan", async () => {
      await asServiceRole();
      const aRem = await db.query<{ r: number | null }>(
        "select private.analysis_remaining($1) as r",
        [W],
      );
      expect(aRem.rows[0].r).toBeNull();

      const tRem = await db.query<{ r: number | null }>(
        "select private.topic_units_remaining($1) as r",
        [W],
      );
      expect(tRem.rows[0].r).toBeNull();

      const bRem = await db.query<{ r: number | null }>(
        "select private.backfill_remaining($1) as r",
        [W],
      );
      expect(bRem.rows[0].r).toBeNull();
    });

    it("reserve_usage succeeds on unlimited plan", async () => {
      await asServiceRole();
      const keys = ["key1", "key2", "key3"];
      const res = await db.query<{ reserve_usage: string[] }>(
        "select private.reserve_usage($1, 'comment_analysis', $2) as reserve_usage",
        [W, keys],
      );
      expect(res.rows[0].reserve_usage).toEqual(expect.arrayContaining(keys));
    });

    it("worker_topics_due does not block on quota_exceeded when topic units are unlimited", async () => {
      await asServiceRole();
      const chId = "00000000-0000-4000-8000-000000000002";
      const clientId = "00000000-0000-4000-8000-000000000003";
      await db.query(
        "insert into clients(id, workspace_id, name) values ($1, $2, 'Client 1') on conflict do nothing",
        [clientId, W],
      );
      await db.query(
        "insert into channels(id, workspace_id, client_id, external_channel_id, platform) values ($1, $2, $3, 'UC_TEST', 'youtube') on conflict do nothing",
        [chId, W, clientId],
      );

      // Create an analyse job
      const jobId = "00000000-0000-4000-8000-000000000004";
      const leaseToken = "00000000-0000-4000-8000-000000000005";
      await db.query(
        `insert into jobs(id, workspace_id, channel_id, type, dedupe_key, status, lease_token, lease_expires_at, attempt)
         values ($1, $2, $3, 'analyse', 'dedupe-analyse-1', 'running', $4, now() + interval '10 minutes', 1)
         on conflict (id) do update set status = 'running', lease_token = $4, lease_expires_at = now() + interval '10 minutes'`,
        [jobId, W, chId, leaseToken],
      );

      const due = await db.query<{ worker_topics_due: WorkerTopicsDueResult }>(
        "select private.worker_topics_due($1, $2, $3, 'gemini-1.5-flash', 'v1', 100) as worker_topics_due",
        [WORKER_TOKEN, jobId, leaseToken],
      );

      expect(due.rows[0].worker_topics_due.blocked).toBeUndefined();
      expect(due.rows[0].worker_topics_due.active).toBe(true);
    });
  });

  describe("Worker job retry lifecycle", () => {
    const chId = "00000000-0000-4000-8000-000000000002";

    it("re-queues with exponential backoff on attempt 1 failure", async () => {
      await asServiceRole();
      const jobId = "00000000-0000-4000-8000-000000000010";
      const leaseToken = "00000000-0000-4000-8000-000000000011";

      await db.query(
        `insert into jobs(id, workspace_id, channel_id, type, dedupe_key, status, lease_token, lease_expires_at, attempt)
         values ($1, $2, $3, 'collect', 'dedupe-retry-1', 'running', $4, now() + interval '10 minutes', 1)
         on conflict (id) do update set status = 'running', lease_token = $4, lease_expires_at = now() + interval '10 minutes', attempt = 1`,
        [jobId, W, chId, leaseToken],
      );

      // Finish attempt 1 with failure
      await db.query(
        "select private.worker_finish($1, $2, $3, 'failed', 'upstream_503')",
        [WORKER_TOKEN, jobId, leaseToken],
      );

      const job = (
        await db.query<{
          status: string;
          attempt: number;
          lease_token: string | null;
          error_code: string;
          not_before: string;
        }>(
          "select status, attempt, lease_token, error_code, not_before from jobs where id = $1",
          [jobId],
        )
      ).rows[0];

      expect(job.status).toBe("queued");
      expect(job.attempt).toBe(1);
      expect(job.lease_token).toBeNull();
      expect(job.error_code).toBe("upstream_503");
      expect(new Date(job.not_before).getTime()).toBeGreaterThan(Date.now());

      // Sync run recorded
      const syncRun = (
        await db.query<{ status: string; error_code: string }>(
          "select status, error_code from sync_runs where job_id = $1",
          [jobId],
        )
      ).rows[0];
      expect(syncRun.status).toBe("failed");
      expect(syncRun.error_code).toBe("upstream_503");
    });

    it("re-queues with further backoff on attempt 2 failure", async () => {
      await asServiceRole();
      const jobId = "00000000-0000-4000-8000-000000000010";
      const leaseToken = "00000000-0000-4000-8000-000000000012";

      // Claim for attempt 2
      await db.query(
        "update jobs set status = 'running', lease_token = $1, lease_expires_at = now() + interval '10 minutes', attempt = 2 where id = $2",
        [leaseToken, jobId],
      );

      // Finish attempt 2 with partial
      await db.query(
        "select private.worker_finish($1, $2, $3, 'partial', 'rate_limit_exceeded')",
        [WORKER_TOKEN, jobId, leaseToken],
      );

      const job = (
        await db.query<{
          status: string;
          attempt: number;
          lease_token: string | null;
          error_code: string;
          not_before: string;
        }>(
          "select status, attempt, lease_token, error_code, not_before from jobs where id = $1",
          [jobId],
        )
      ).rows[0];

      expect(job.status).toBe("queued");
      expect(job.attempt).toBe(2);
      expect(job.lease_token).toBeNull();
      expect(job.error_code).toBe("rate_limit_exceeded");
      expect(new Date(job.not_before).getTime()).toBeGreaterThan(Date.now());
    });

    it("marks terminal 'failed' with retry_exhausted when attempt >= 3 fails", async () => {
      await asServiceRole();
      const jobId = "00000000-0000-4000-8000-000000000010";
      const leaseToken = "00000000-0000-4000-8000-000000000013";

      // Claim for attempt 3
      await db.query(
        "update jobs set status = 'running', lease_token = $1, lease_expires_at = now() + interval '10 minutes', attempt = 3 where id = $2",
        [leaseToken, jobId],
      );

      // Finish attempt 3 with failure
      await db.query(
        "select private.worker_finish($1, $2, $3, 'failed', 'upstream_503')",
        [WORKER_TOKEN, jobId, leaseToken],
      );

      const job = (
        await db.query<{
          status: string;
          attempt: number;
          lease_token: string | null;
          error_code: string;
        }>(
          "select status, attempt, lease_token, error_code from jobs where id = $1",
          [jobId],
        )
      ).rows[0];

      expect(job.status).toBe("failed");
      expect(job.attempt).toBe(3);
      expect(job.lease_token).toBeNull();
      expect(job.error_code).toBe("retry_exhausted:upstream_503");

      const syncRun = (
        await db.query<{ status: string; error_code: string }>(
          "select status, error_code from sync_runs where job_id = $1",
          [jobId],
        )
      ).rows[0];
      expect(syncRun.status).toBe("failed");
      expect(syncRun.error_code).toBe("retry_exhausted:upstream_503");
    });

    it("marks succeeded and clears error on success", async () => {
      await asServiceRole();
      const jobId = "00000000-0000-4000-8000-000000000020";
      const leaseToken = "00000000-0000-4000-8000-000000000021";

      await db.query(
        `insert into jobs(id, workspace_id, channel_id, type, dedupe_key, status, lease_token, lease_expires_at, attempt)
         values ($1, $2, $3, 'collect', 'dedupe-success-1', 'running', $4, now() + interval '10 minutes', 1)`,
        [jobId, W, chId, leaseToken],
      );

      await db.query(
        "select private.worker_finish($1, $2, $3, 'succeeded', null)",
        [WORKER_TOKEN, jobId, leaseToken],
      );

      const job = (
        await db.query<{
          status: string;
          lease_token: string | null;
          error_code: string | null;
          last_error: string | null;
        }>(
          "select status, lease_token, error_code, last_error from jobs where id = $1",
          [jobId],
        )
      ).rows[0];

      expect(job.status).toBe("succeeded");
      expect(job.lease_token).toBeNull();
      expect(job.error_code).toBeNull();
      expect(job.last_error).toBeNull();

      const syncRun = (
        await db.query<{ status: string; error_code: string | null }>(
          "select status, error_code from sync_runs where job_id = $1",
          [jobId],
        )
      ).rows[0];
      expect(syncRun.status).toBe("succeeded");
      expect(syncRun.error_code).toBeNull();
    });

    it("sets not_before to next reset on blocked: quota_exceeded", async () => {
      await asServiceRole();
      const jobId = "00000000-0000-4000-8000-000000000030";
      const leaseToken = "00000000-0000-4000-8000-000000000031";
      const periodEnd = new Date(Date.now() + 5 * 86400 * 1000).toISOString();

      // Set subscription period_end to a known future date
      await db.query(
        "update subscriptions set period_end = $1 where workspace_id = $2",
        [periodEnd, W],
      );

      await db.query(
        `insert into jobs(id, workspace_id, channel_id, type, dedupe_key, status, lease_token, lease_expires_at, attempt)
         values ($1, $2, $3, 'collect', 'dedupe-blocked-quota', 'running', $4, now() + interval '10 minutes', 1)`,
        [jobId, W, chId, leaseToken],
      );

      await db.query(
        "select private.worker_finish($1, $2, $3, 'blocked', 'quota_exceeded')",
        [WORKER_TOKEN, jobId, leaseToken],
      );

      const job = (
        await db.query<{
          status: string;
          not_before: string;
          error_code: string;
        }>("select status, not_before, error_code from jobs where id = $1", [
          jobId,
        ])
      ).rows[0];

      expect(job.status).toBe("blocked");
      expect(job.error_code).toBe("quota_exceeded");
      expect(new Date(job.not_before).toISOString()).toBe(
        new Date(periodEnd).toISOString(),
      );
    });

    it("sets not_before to NULL on blocked for non-time-based reasons (plan_inactive, source_access_denied)", async () => {
      await asServiceRole();
      const jobId1 = "00000000-0000-4000-8000-000000000032";
      const leaseToken1 = "00000000-0000-4000-8000-000000000033";
      const jobId2 = "00000000-0000-4000-8000-000000000034";
      const leaseToken2 = "00000000-0000-4000-8000-000000000035";

      await db.query(
        `insert into jobs(id, workspace_id, channel_id, type, dedupe_key, status, lease_token, lease_expires_at, attempt)
         values ($1, $2, $3, 'collect', 'dedupe-blocked-plan', 'running', $4, now() + interval '10 minutes', 1)`,
        [jobId1, W, chId, leaseToken1],
      );

      await db.query(
        "select private.worker_finish($1, $2, $3, 'blocked', 'plan_inactive')",
        [WORKER_TOKEN, jobId1, leaseToken1],
      );

      await db.query(
        `insert into jobs(id, workspace_id, channel_id, type, dedupe_key, status, lease_token, lease_expires_at, attempt)
         values ($1, $2, $3, 'collect', 'dedupe-blocked-source', 'running', $4, now() + interval '10 minutes', 1)`,
        [jobId2, W, chId, leaseToken2],
      );

      await db.query(
        "select private.worker_finish($1, $2, $3, 'blocked', 'source_access_denied')",
        [WORKER_TOKEN, jobId2, leaseToken2],
      );

      const job1 = (
        await db.query<{ status: string; not_before: string | null }>(
          "select status, not_before from jobs where id = $1",
          [jobId1],
        )
      ).rows[0];
      const job2 = (
        await db.query<{ status: string; not_before: string | null }>(
          "select status, not_before from jobs where id = $1",
          [jobId2],
        )
      ).rows[0];

      expect(job1.status).toBe("blocked");
      expect(job1.not_before).toBeNull();

      expect(job2.status).toBe("blocked");
      expect(job2.not_before).toBeNull();
    });

    it("unblock_due_jobs unblocks due quota jobs without resetting attempt or reclaims, and ignores NULL not_before", async () => {
      await asServiceRole();
      const dueJobId = "00000000-0000-4000-8000-000000000036";
      const nonTimeJobId = "00000000-0000-4000-8000-000000000037";

      // Insert a time-based blocked job with not_before in past, and non-zero attempt/reclaims
      await db.query(
        `insert into jobs(id, workspace_id, channel_id, type, dedupe_key, status, not_before, attempt, reclaims, error_code)
         values ($1, $2, $3, 'collect', 'dedupe-unblock-due', 'blocked', now() - interval '1 minute', 2, 1, 'quota_exceeded'),
                ($4, $2, $3, 'collect', 'dedupe-unblock-notime', 'blocked', null, 1, 0, 'plan_inactive')`,
        [dueJobId, W, chId, nonTimeJobId],
      );

      const unblockedCount = await db.query<{ unblock_due_jobs: number }>(
        "select private.unblock_due_jobs()",
      );
      expect(unblockedCount.rows[0].unblock_due_jobs).toBeGreaterThanOrEqual(1);

      // Verify the due job unblocked to queued, and attempt/reclaims were preserved
      const dueJob = (
        await db.query<{
          status: string;
          attempt: number;
          reclaims: number;
          error_code: string | null;
        }>(
          "select status, attempt, reclaims, error_code from jobs where id = $1",
          [dueJobId],
        )
      ).rows[0];
      expect(dueJob.status).toBe("queued");
      expect(dueJob.attempt).toBe(2);
      expect(dueJob.reclaims).toBe(1);
      expect(dueJob.error_code).toBeNull();

      // Verify the non-time-based job remains blocked
      const nonTimeJob = (
        await db.query<{ status: string; not_before: string | null }>(
          "select status, not_before from jobs where id = $1",
          [nonTimeJobId],
        )
      ).rows[0];
      expect(nonTimeJob.status).toBe("blocked");
      expect(nonTimeJob.not_before).toBeNull();
    });
  });
});
