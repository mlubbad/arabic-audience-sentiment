/**
 * The public catalogue: what the pricing page reads signed out. It never
 * exposes an internal plan, its limits are the table's own numbers, and
 * usage_summary now names the plan and the billing fields beside it.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const OWNER = "10000000-0000-4000-8000-000000000001";
let db: PGlite;
const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};
const bootstrap = async () => {
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
};

describe("plan catalogue", () => {
  beforeAll(bootstrap);

  it("anon reads six sellable plans and never owner or pilot", async () => {
    await db.exec("reset role; set role anon");
    const r = await db.query<{
      plan_catalogue: { key: string; segment: string }[];
    }>("select plan_catalogue()");
    expect(r.rows[0].plan_catalogue.map((p) => p.key)).toEqual([
      "free",
      "creator",
      "creator_plus",
      "agency",
      "media",
      "enterprise",
    ]);
  });

  it("a plan's limits are the table's numbers", async () => {
    await db.exec("reset role; set role anon");
    const r = await db.query<{
      plan_catalogue: { key: string; limits: Record<string, number> }[];
    }>("select plan_catalogue()");
    expect(
      r.rows[0].plan_catalogue.find((p) => p.key === "agency")!.limits,
    ).toEqual({
      analysis_units: 150000,
      topic_units: 60000,
      insight_reports: 200,
      channels: 10,
      members: 10,
      workspaces: 5,
      live_interval_minutes: 360,
    });
  });

  it("usage_summary names the plan and its limits", async () => {
    // OWNER's personal workspace, on free by the trigger.
    await as(OWNER);
    const w = (
      await db.query<{ id: string }>(
        "select id from workspaces where created_by=$1",
        [OWNER],
      )
    ).rows[0].id;
    const r = await db.query<{
      usage_summary: {
        plan: { key: string; limits: { channels: number } };
        provider: string | null;
      };
    }>("select usage_summary($1)", [w]);
    expect(r.rows[0].usage_summary.plan).toMatchObject({
      key: "free",
      limits: { channels: 0 },
    });
    expect(r.rows[0].usage_summary.provider).toBeNull();
  });

  it("the pilot row is titled Founding Partner in both languages", async () => {
    await db.exec("reset role");
    const r = await db.query<{ title_ar: string; title_en: string }>(
      "select title_ar, title_en from plans where key='pilot'",
    );
    expect(r.rows[0]).toEqual({
      title_ar: "شريك مؤسِّس",
      title_en: "Founding Partner",
    });
  });

  it("admin_plan_catalogue lists every plan, internal ones included, for an admin only", async () => {
    await db.exec("reset role");
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      OWNER,
    ]);
    await as(OWNER);
    const r = await db.query<{
      admin_plan_catalogue: { key: string; title_en: string }[];
    }>("select admin_plan_catalogue()");
    const keys = r.rows[0].admin_plan_catalogue.map((p) => p.key);
    expect(keys).toEqual([
      "free",
      "creator",
      "creator_plus",
      "agency",
      "media",
      "enterprise",
      "owner",
      "pilot",
    ]);
    expect(
      r.rows[0].admin_plan_catalogue.find((p) => p.key === "pilot")!.title_en,
    ).toBe("Founding Partner");
    await db.exec("reset role");
    await db.query("delete from private.platform_admins where user_id=$1", [
      OWNER,
    ]);
    await as(OWNER);
    await expect(db.query("select admin_plan_catalogue()")).rejects.toThrow(
      /forbidden/,
    );
    await db.exec("reset role; set role anon");
    await expect(db.query("select admin_plan_catalogue()")).rejects.toThrow(
      /permission denied|forbidden/,
    );
  });
});
