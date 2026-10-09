/**
 * `admin_import_channel`: the platform owner's bulk import, one call per
 * channel.
 *
 * Each call makes one workspace named after the channel, files the channel in
 * it and asks for its first catalogue run. A channel the owner's account
 * already holds is answered with the workspace that holds it and nothing is
 * created. Only a platform admin may call it, and a refused row leaves no
 * workspace behind.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const ADMIN_FREE = "10000000-0000-4000-8000-000000000003";
const HOME = "00000000-0000-4000-8000-000000000001";
const OTHER_HOME = "00000000-0000-4000-8000-000000000002";
const FREE_HOME = "00000000-0000-4000-8000-000000000003";
const CH1 = "UCAAAAAAAAAAAAAAAAAAAAA1";
const CH2 = "UCAAAAAAAAAAAAAAAAAAAAA2";
const CH3 = "UCAAAAAAAAAAAAAAAAAAAAA3";
const CH4 = "UCAAAAAAAAAAAAAAAAAAAAA4";
const CH5 = "UCAAAAAAAAAAAAAAAAAAAAA5";
let db: PGlite;

type Result = {
  status: "created" | "exists";
  workspace_id: string;
  workspace_name: string;
  channel_id?: string;
  job_id?: string;
};

async function as(role: "authenticated" | "anon", sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    sub ?? "",
  ]);
  await db.exec(`set role ${role}`);
}

async function importChannel(
  external: string,
  title: string | null = null,
  handle: string | null = null,
): Promise<Result> {
  const { rows } = await db.query<{ r: Result }>(
    "select public.admin_import_channel($1,$2,$3) as r",
    [external, title, handle],
  );
  return rows[0]!.r;
}

async function count(sql: string, params: unknown[] = []) {
  await db.exec("reset role");
  const { rows } = await db.query<{ n: number }>(sql, params);
  return rows[0]!.n;
}

afterAll(async () => {
  await db?.close();
});

describe("admin_import_channel", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const f of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));

    await db.query("insert into auth.users(id) values ($1),($2),($3)", [
      ADMIN,
      OTHER,
      ADMIN_FREE,
    ]);
    await db.query(
      "insert into private.platform_admins(user_id) values ($1),($2)",
      [ADMIN, ADMIN_FREE],
    );
    // Each user's home workspace: the first they created, which the new
    // workspaces bill to. The admin's is on the internal owner plan.
    await db.query(
      `insert into workspaces(id,name,created_by,created_at) values
         ($1,'Home',$4,now()-interval '1 day'),
         ($2,'Other home',$5,now()-interval '1 day'),
         ($3,'Free home',$6,now()-interval '1 day')`,
      [HOME, OTHER_HOME, FREE_HOME, ADMIN, OTHER, ADMIN_FREE],
    );
    await db.query(
      `insert into memberships values ($1,$4,'workspace_owner'),($2,$5,'workspace_owner'),($3,$6,'workspace_owner')`,
      [HOME, OTHER_HOME, FREE_HOME, ADMIN, OTHER, ADMIN_FREE],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'Home'),($2,$2,'Other'),($3,$3,'Free')",
      [HOME, OTHER_HOME, FREE_HOME],
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values
         ($1,'owner','active',now(),now()+interval '30 days'),
         ($2,'owner','active',now(),now()+interval '30 days'),
         ($3,'free','active',now(),now()+interval '30 days')`,
      [HOME, OTHER_HOME, FREE_HOME],
    );
  });

  it("makes a workspace named after the channel, files the channel and asks for its catalogue", async () => {
    await as("authenticated", ADMIN);
    const r = await importChannel(CH1, "قناة سعود Saud Channel", "@saud");
    expect(r.status).toBe("created");
    expect(r.workspace_name).toBe("قناة سعود Saud Channel");

    await db.exec("reset role");
    const ws = await db.query<{ name: string; created_by: string }>(
      "select name, created_by from workspaces where id=$1",
      [r.workspace_id],
    );
    expect(ws.rows[0]).toEqual({
      name: "قناة سعود Saud Channel",
      created_by: ADMIN,
    });
    const role = await db.query<{ role: string }>(
      "select role from memberships where workspace_id=$1 and user_id=$2",
      [r.workspace_id, ADMIN],
    );
    expect(role.rows[0]!.role).toBe("workspace_owner");
    const ch = await db.query<{
      id: string;
      external_channel_id: string;
      status: string;
      title: string;
      handle: string;
    }>(
      "select id, external_channel_id, status, title, handle from channels where workspace_id=$1",
      [r.workspace_id],
    );
    expect(ch.rows).toHaveLength(1);
    expect(ch.rows[0]).toMatchObject({
      id: r.channel_id,
      external_channel_id: CH1,
      status: "public_unverified",
      title: "قناة سعود Saud Channel",
      handle: "@saud",
    });
    // The first catalogue run is queued at once; the scheduler takes it from there.
    const job = await db.query<{ type: string; status: string }>(
      "select type, status from jobs where id=$1 and channel_id=$2",
      [r.job_id, r.channel_id],
    );
    expect(job.rows[0]).toEqual({ type: "discover", status: "queued" });
    // Billed to the owner's home workspace, on its plan.
    const sub = await db.query<{
      plan_key: string;
      billing_workspace_id: string;
    }>(
      "select plan_key, billing_workspace_id from subscriptions where workspace_id=$1",
      [r.workspace_id],
    );
    expect(sub.rows[0]).toEqual({
      plan_key: "owner",
      billing_workspace_id: HOME,
    });
    expect(
      await count(
        "select count(*)::int as n from audit_events where workspace_id=$1 and action='channel_imported' and target_id=$2",
        [r.workspace_id, r.channel_id],
      ),
    ).toBe(1);
  });

  it("answers a second import of the same channel with the workspace that holds it", async () => {
    await as("authenticated", ADMIN);
    const first = await importChannel(CH2, "Second");
    const before = await count("select count(*)::int as n from workspaces");
    await as("authenticated", ADMIN);
    const again = await importChannel(CH2, "Second, renamed");
    expect(again).toEqual({
      status: "exists",
      workspace_id: first.workspace_id,
      workspace_name: "Second",
    });
    expect(await count("select count(*)::int as n from workspaces")).toBe(
      before,
    );
    expect(
      await count(
        "select count(*)::int as n from channels where external_channel_id=$1",
        [CH2],
      ),
    ).toBe(1);
  });

  it("does not import a channel the account already holds in another workspace", async () => {
    // Filed by hand in the owner's home workspace before any import.
    await as("authenticated", ADMIN);
    await db.query("select register_public_channel($1,$1,$2,null,'By hand')", [
      HOME,
      CH3,
    ]);
    const before = await count("select count(*)::int as n from workspaces");
    await as("authenticated", ADMIN);
    const r = await importChannel(CH3, "By import");
    expect(r).toEqual({
      status: "exists",
      workspace_id: HOME,
      workspace_name: "Home",
    });
    expect(await count("select count(*)::int as n from workspaces")).toBe(
      before,
    );
  });

  it("counts only the owner's own account: another user's copy of the channel does not block it", async () => {
    await as("authenticated", OTHER);
    await db.query("select register_public_channel($1,$1,$2,null,'Theirs')", [
      OTHER_HOME,
      CH4,
    ]);
    await as("authenticated", ADMIN);
    const r = await importChannel(CH4, "Mine");
    expect(r.status).toBe("created");
    expect(r.workspace_id).not.toBe(OTHER_HOME);
  });

  it("names the workspace by the handle when there is no title, and cuts a long title to 120", async () => {
    await as("authenticated", ADMIN);
    const byHandle = await importChannel(CH5, null, "@handle_only");
    expect(byHandle.workspace_name).toBe("@handle_only");

    await as("authenticated", ADMIN);
    const long = await importChannel(
      "UCAAAAAAAAAAAAAAAAAAAAA6",
      "x".repeat(200),
    );
    expect(long.workspace_name).toHaveLength(120);
  });

  it("refuses a malformed channel id and a platform it cannot confirm", async () => {
    await as("authenticated", ADMIN);
    await expect(importChannel("not-a-channel-id", "Bad")).rejects.toThrow(
      /invalid_channel_id/,
    );
    await as("authenticated", ADMIN);
    await expect(
      db.query("select public.admin_import_channel($1,'T',null,'telegram')", [
        CH1,
      ]),
    ).rejects.toThrow(/invalid_platform/);
  });

  it("leaves no workspace behind when the channel cannot be filed", async () => {
    // This admin's home is on the free plan, which allows no public channels.
    // Its workspace limit is raised so the workspace is made first and the
    // refusal comes after it: the case where a half-made row could be left.
    await db.exec("reset role");
    await db.exec("update plans set workspaces_limit = 10 where key = 'free'");
    const before = await count(
      "select count(*)::int as n from workspaces where created_by=$1",
      [ADMIN_FREE],
    );
    await as("authenticated", ADMIN_FREE);
    await expect(
      importChannel("UCAAAAAAAAAAAAAAAAAAAAA7", "Refused"),
    ).rejects.toThrow(/public_channels_not_allowed_on_plan/);
    expect(
      await count(
        "select count(*)::int as n from workspaces where created_by=$1",
        [ADMIN_FREE],
      ),
    ).toBe(before);
  });

  it("refuses everyone but a platform admin", async () => {
    const before = await count("select count(*)::int as n from workspaces");
    await as("authenticated", OTHER);
    await expect(
      importChannel("UCAAAAAAAAAAAAAAAAAAAAA8", "Not mine to import"),
    ).rejects.toThrow(/forbidden/);
    await as("anon", null);
    await expect(
      importChannel("UCAAAAAAAAAAAAAAAAAAAAA8", "Anon"),
    ).rejects.toThrow(/permission denied/);
    expect(await count("select count(*)::int as n from workspaces")).toBe(
      before,
    );
  });
});

describe("automatic selection of an imported channel's videos", () => {
  let ws = "";
  let ch = "";
  const AUTO = "UCAAAAAAAAAAAAAAAAAAAAB1";

  async function tick() {
    await db.exec("reset role");
    await db.query("select private.schedule_due_work($1)", [ws]);
  }
  async function selected() {
    await db.exec("reset role");
    const { rows } = await db.query<{ title: string }>(
      `select v.title from video_selections s join videos v on v.workspace_id=s.workspace_id and v.id=s.video_id
        where s.workspace_id=$1 order by v.published_at desc`,
      [ws],
    );
    return rows.map((r) => r.title);
  }
  /** Videos as a catalogue run files them: published `hoursAgo` hours ago. */
  async function catalogue(
    videos: {
      title: string;
      hoursAgo: number;
      kind?: string;
      disabled?: boolean;
    }[],
  ) {
    await db.exec("reset role");
    for (const v of videos)
      await db.query(
        `insert into videos(workspace_id, channel_id, external_video_id, title, kind, published_at, comments_state)
         values ($1,$2,$3,$3,$4, now() - make_interval(hours => $5::int), $6)`,
        [
          ws,
          ch,
          v.title,
          v.kind ?? "video",
          v.hoursAgo,
          v.disabled ? "disabled" : "open",
        ],
      );
    await db.query(
      "update channels set catalogued_at = now() where workspace_id=$1 and id=$2",
      [ws, ch],
    );
  }

  beforeAll(async () => {
    await as("authenticated", ADMIN);
    const r = await importChannel(AUTO, "Auto");
    ws = r.workspace_id;
    ch = r.channel_id!;
  });

  it("records the import's numbers: the latest 20, then 5 new a day", async () => {
    await db.exec("reset role");
    const { rows } = await db.query<{
      initial_count: number;
      daily_cap: number;
      created_by: string;
    }>(
      "select initial_count, daily_cap, created_by from private.channel_auto_selection where workspace_id=$1 and channel_id=$2",
      [ws, ch],
    );
    expect(rows).toEqual([
      { initial_count: 20, daily_cap: 5, created_by: ADMIN },
    ]);
  });

  it("selects nothing while the first catalogue run is still queued", async () => {
    await catalogue([{ title: "early", hoursAgo: 1000 }]);
    await tick();
    expect(await selected()).toEqual([]);
  });

  it("selects the latest 20 once the catalogue is in, skipping posts and closed comments, and starts a collection", async () => {
    await db.exec("reset role");
    await db.query(
      "update jobs set status='succeeded' where workspace_id=$1 and type='discover'",
      [ws],
    );
    await catalogue([
      ...Array.from({ length: 24 }, (_, i) => ({
        title: `v${String(i).padStart(2, "0")}`,
        hoursAgo: 100 + i,
      })),
      { title: "post", hoursAgo: 10, kind: "channel_post" },
      { title: "closed", hoursAgo: 11, disabled: true },
    ]);
    await tick();
    const picked = await selected();
    expect(picked).toHaveLength(20);
    expect(picked[0]).toBe("v00");
    expect(picked).not.toContain("post");
    expect(picked).not.toContain("closed");
    expect(picked).not.toContain("early");
    expect(
      await count(
        "select count(*)::int as n from jobs where workspace_id=$1 and type='collect' and status='queued'",
        [ws],
      ),
    ).toBe(1);

    // The back catalogue is never chosen later on.
    await tick();
    expect(await selected()).toHaveLength(20);
  });

  it("adds videos published after the first selection, at most 5 a day", async () => {
    await catalogue(
      Array.from({ length: 7 }, (_, i) => ({
        title: `new${i}`,
        hoursAgo: -1 - i,
      })),
    );
    await tick();
    expect((await selected()).filter((t) => t.startsWith("new"))).toHaveLength(
      5,
    );
    await tick();
    expect((await selected()).filter((t) => t.startsWith("new"))).toHaveLength(
      5,
    );

    // A day later the cap has room again for the last two.
    await db.exec("reset role");
    await db.query(
      "update private.auto_selected_videos set selected_at = now() - interval '25 hours' where workspace_id=$1",
      [ws],
    );
    await tick();
    expect((await selected()).filter((t) => t.startsWith("new"))).toHaveLength(
      7,
    );
  });

  it("never re-selects a video a person deselected", async () => {
    await db.exec("reset role");
    await db.query(
      `delete from video_selections s using videos v
        where s.workspace_id=$1 and v.workspace_id=s.workspace_id and v.id=s.video_id and v.title='new0'`,
      [ws],
    );
    await db.query(
      "update private.auto_selected_videos set selected_at = now() - interval '25 hours' where workspace_id=$1",
      [ws],
    );
    await tick();
    expect(await selected()).not.toContain("new0");
  });

  it("leaves channels that were not imported alone", async () => {
    // HOME's hand-filed channel has catalogued videos but no automatic selection.
    await db.exec("reset role");
    const { rows } = await db.query<{ id: string }>(
      "select id from channels where workspace_id=$1 and external_channel_id=$2",
      [HOME, CH3],
    );
    await db.query(
      `insert into videos(workspace_id, channel_id, external_video_id, title, published_at, comments_state)
       values ($1,$2,'home-v','home-v', now(), 'open')`,
      [HOME, rows[0]!.id],
    );
    await db.query("update channels set catalogued_at = now() where id=$1", [
      rows[0]!.id,
    ]);
    await db.query("select private.schedule_due_work($1)", [HOME]);
    expect(
      await count(
        "select count(*)::int as n from video_selections where workspace_id=$1",
        [HOME],
      ),
    ).toBe(0);
  });
});
