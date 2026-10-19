import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// A refresh discover that has waited six hours is claimed before collects.
//
// Production, 2026-10-18 21:35 UTC: 116 refresh discovers queued and eligible,
// 7 to 41 hours old (median 40), none claimed since 10-17: 20261031000000 put
// every refresh discover after every collect and analyse, and collects never
// ran out. So no channel had a profile or daily statistics (WO-20/21) and no
// catalogue was refreshed. The first discover of a channel still goes first.

const OWNER = "10000000-0000-4000-8000-000000000001";
const W = "00000000-0000-4000-8000-000000000001";
const CATALOGUED = "00000000-0000-4000-8000-0000000000a1";
const UNCATALOGUED = "00000000-0000-4000-8000-0000000000a2";
const OTHER = "00000000-0000-4000-8000-0000000000a3";

let db: PGlite;

async function job(
  key: string,
  channel: string,
  type: string,
  createdAgo: string,
  extra: { status?: string; notBefore?: string } = {},
) {
  await db.query(
    `insert into jobs(workspace_id, channel_id, type, dedupe_key, status, created_at, not_before)
     values ($1, $2, $3, $4, $5, now() - $6::interval, now() + $7::interval)`,
    [
      W,
      channel,
      type,
      key,
      extra.status ?? "queued",
      createdAgo,
      extra.notBefore ?? "-1 minute",
    ],
  );
}

const claim = async () =>
  (
    await db.query<{ dedupe_key: string }>(
      "select dedupe_key from private.claim_job(null, null)",
    )
  ).rows[0]?.dedupe_key ?? null;

describe("claim order between refresh discovers and collects", () => {
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
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await db.query("insert into auth.users(id) values ($1)", [OWNER]);
    await db.query(
      "insert into workspaces(id, name, created_by) values ($1, 'W', $2)",
      [W, OWNER],
    );
    await db.query(
      "insert into clients(id, workspace_id, name) values ($1, $1, 'c')",
      [W],
    );
    await db.query(
      `insert into channels(id, workspace_id, client_id, external_channel_id, platform, catalogued_at)
       values ($1, $4, $4, 'UC_catalogued', 'youtube', now() - interval '2 days'),
              ($2, $4, $4, 'UC_uncatalogued', 'youtube', null),
              ($3, $4, $4, 'UC_other', 'youtube', now() - interval '2 days')`,
      [CATALOGUED, UNCATALOGUED, OTHER, W],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.exec("delete from sync_runs; delete from jobs");
  });

  it("claims a refresh discover that has waited more than six hours before a collect", async () => {
    // The collect has been eligible longer; under the old order it went first
    // and the discover waited for the queue of collects to run dry.
    await job("collect", OTHER, "collect", "10 hours", {
      notBefore: "-9 hours",
    });
    await job("overdue-refresh", CATALOGUED, "discover", "7 hours");
    expect(await claim()).toBe("overdue-refresh");
    expect(await claim()).toBe("collect");
  });

  it("keeps a younger refresh discover behind the collects", async () => {
    await job("young-refresh", CATALOGUED, "discover", "5 hours", {
      notBefore: "-5 hours",
    });
    await job("collect", OTHER, "collect", "1 hour");
    expect(await claim()).toBe("collect");
    expect(await claim()).toBe("young-refresh");
  });

  it("still claims a channel's first discover before an overdue refresh and a collect", async () => {
    await job("overdue-refresh", CATALOGUED, "discover", "20 hours", {
      notBefore: "-20 hours",
    });
    await job("collect", OTHER, "collect", "20 hours", {
      notBefore: "-20 hours",
    });
    await job("first", UNCATALOGUED, "discover", "1 minute");
    expect(await claim()).toBe("first");
    expect(await claim()).toBe("overdue-refresh");
    expect(await claim()).toBe("collect");
  });

  it("does not claim an overdue discover early while it waits for a quota reset", async () => {
    // Blocked until the reset, and queued with a not_before still to come:
    // neither is claimable however long it has existed.
    await job("blocked", CATALOGUED, "discover", "30 hours", {
      status: "blocked",
      notBefore: "3 hours",
    });
    await job("held", OTHER, "discover", "30 hours", { notBefore: "3 hours" });
    await job("collect", UNCATALOGUED, "collect", "1 hour");
    expect(await claim()).toBe("collect");
    expect(await claim()).toBeNull();
  });
});
