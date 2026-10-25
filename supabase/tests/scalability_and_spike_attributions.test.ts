import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W1 = "00000000-0000-4000-8000-000000000001";
const W2 = "00000000-0000-4000-8000-000000000002";
const CH1 = "00000000-0000-4000-8000-0000000000a1";
const CH2 = "00000000-0000-4000-8000-0000000000a2";
const OWNER1 = "10000000-0000-4000-8000-000000000001";
const STRANGER = "10000000-0000-4000-8000-000000000009";
const PLATFORM_SECRET = "platform-" + "p".repeat(55);
const PLATFORM_HASH = createHash("sha256")
  .update(PLATFORM_SECRET)
  .digest("hex");

let db: PGlite;

async function as(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}

describe("scalability improvements and Seltz spike attributions", () => {
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(
      "create schema extensions; create extension pgcrypto with schema extensions;",
    );
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

    await db.query("insert into auth.users(id) values ($1),($2)", [
      OWNER1,
      STRANGER,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'WS1',$3),($2,'WS2',$3)",
      [W1, W2, OWNER1],
    );
    await db.query(
      "insert into memberships values ($1,$3,'workspace_owner'),($2,$3,'workspace_owner')",
      [W1, W2, OWNER1],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'C1'),($2,$2,'C2')",
      [W1, W2],
    );
    await db.query(
      `insert into channels(id,workspace_id,client_id,external_channel_id,platform,catalogued_at)
       values ($1,$3,$3,'UC_ch1_00000000000000000','youtube',now()-interval '1 hour'),
              ($2,$4,$4,'UC_ch2_00000000000000000','youtube',now()-interval '1 hour')`,
      [CH1, CH2, W1, W2],
    );
    await db.query(
      "select public.svc_register_platform_worker_credential($1,'platform')",
      [PLATFORM_SECRET],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  it("touch_worker_seen inserts missing rows immediately and throttles redundant updates within 30s", async () => {
    await db.exec("reset role");
    await db.query("delete from public.worker_seen");
    await db.query("select private.touch_worker_seen($1)", [PLATFORM_HASH]);

    const initial = await db.query<{ last_seen_at: string }>(
      "select last_seen_at::text from public.worker_seen where workspace_id = $1",
      [W1],
    );
    expect(initial.rows).toHaveLength(1);

    // Wind W1 back by 10 seconds (< 30s threshold): touch_worker_seen must skip updating it
    await db.query(
      "update public.worker_seen set last_seen_at = '2099-01-01T00:00:00Z'::timestamptz where workspace_id = $1",
      [W1],
    );
    await db.query("select private.touch_worker_seen($1)", [PLATFORM_HASH]);
    const skipped = await db.query<{ ts: string }>(
      "select last_seen_at::text as ts from public.worker_seen where workspace_id = $1",
      [W1],
    );
    expect(skipped.rows[0].ts).toContain("2099-01-01");

    // Wind W1 back by 2 minutes (> 30s threshold): touch_worker_seen refreshes it
    await db.query(
      "update public.worker_seen set last_seen_at = now() - interval '2 minutes' where workspace_id = $1",
      [W1],
    );
    await db.query("select private.touch_worker_seen($1)", [PLATFORM_HASH]);
    const refreshed = await db.query<{ fresh: boolean }>(
      "select (last_seen_at > now() - interval '5 seconds') as fresh from public.worker_seen where workspace_id = $1",
      [W1],
    );
    expect(refreshed.rows[0].fresh).toBe(true);
  });

  it("drain_dashboard_aggregates drains up to 10 pending filter sets in one default call", async () => {
    await as(OWNER1);
    const sentiments = ["positive", "negative", "neutral", "mixed"] as const;
    for (const s of sentiments) {
      const r = await db.query<{ r: { cache: { state: string } } }>(
        "select public.dashboard_aggregates($1, $2::jsonb) as r",
        [W1, JSON.stringify({ sentiment: s })],
      );
      expect(r.rows[0].r.cache.state).toBe("pending");
    }

    await db.exec("reset role");
    const drained = await db.query<{ n: number }>(
      "select private.drain_dashboard_aggregates() as n",
    );
    expect(drained.rows[0].n).toBeGreaterThanOrEqual(4);

    await as(OWNER1);
    for (const s of sentiments) {
      const r = await db.query<{ r: { cache: { state: string } } }>(
        "select public.dashboard_aggregates($1, $2::jsonb) as r",
        [W1, JSON.stringify({ sentiment: s })],
      );
      expect(r.rows[0].r.cache.state).toBe("fresh");
    }
  });

  it("stores and serves Seltz spike attributions under tenant RLS and enforces invariants", async () => {
    await db.exec("reset role");

    // Succeeded attribution without headline_ar is rejected by CHECK constraint
    await expect(
      db.query(
        `insert into public.sentiment_spike_attributions(
          workspace_id, channel_id, from_date, to_date, dominant_sentiment, query, status, headline_ar, summary_ar
        ) values ($1, $2, '2026-10-15', '2026-10-18', 'mixed', 'الجزيرة 360', 'succeeded', null, 'ملخص')`,
        [W1, CH1],
      ),
    ).rejects.toThrow();

    // Failed attribution without error_code is rejected by CHECK constraint
    await expect(
      db.query(
        `insert into public.sentiment_spike_attributions(
          workspace_id, channel_id, from_date, to_date, dominant_sentiment, query, status, error_code
        ) values ($1, $2, '2026-10-15', '2026-10-18', 'negative', 'الجزيرة 360', 'failed', null)`,
        [W1, CH1],
      ),
    ).rejects.toThrow();

    // Valid succeeded attribution with 'mixed' sentiment
    await db.query(
      `insert into public.sentiment_spike_attributions(
        workspace_id, channel_id, from_date, to_date, dominant_sentiment, query, scope, status, headline_ar, summary_ar, citations
      ) values (
        $1, $2, '2026-10-15', '2026-10-18', 'mixed', 'الجزيرة 360 وثائقي', 'news', 'succeeded',
        'إطلاق سلسلة وثائقية جديدة على منصة الجزيرة 360',
        'تزامنت طفرة التعليقات المختلطة مع نقاش واسع حول الحلقة الافتتاحية.',
        '[{"url":"https://aljazeera360.com/doc1","published_date":"2026-10-16"}]'::jsonb
      )`,
      [W1, CH1],
    );

    // Owner can list spike attributions via RPC
    await as(OWNER1);
    const listRes = await db.query<{
      r: Array<{
        dominant_sentiment: string;
        status: string;
        headline_ar: string;
      }>;
    }>("select public.list_spike_attributions($1, 10) as r", [CH1]);
    expect(listRes.rows[0].r).toHaveLength(1);
    expect(listRes.rows[0].r[0]).toMatchObject({
      dominant_sentiment: "mixed",
      status: "succeeded",
      headline_ar: "إطلاق سلسلة وثائقية جديدة على منصة الجزيرة 360",
    });

    // Stranger is refused by both RPC and direct table RLS
    await as(STRANGER);
    await expect(
      db.query("select public.list_spike_attributions($1, 10)", [CH1]),
    ).rejects.toThrow(/forbidden/);
    const directRows = await db.query(
      "select * from public.sentiment_spike_attributions where channel_id = $1",
      [CH1],
    );
    expect(directRows.rows).toHaveLength(0);
  });
});
