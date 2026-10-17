/**
 * Renaming a workspace, and handing one over.
 *
 * "Delete" in the account page is not a deletion: the owner asked that nothing
 * collected is ever dropped. Retiring a workspace removes its members, revokes
 * the Google grant that belonged to the leaving owner, cancels pending work,
 * and moves the workspace under the platform owner's own root — the rows stay
 * where they are, with a record of whose they were.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const OWNER = "10000000-0000-4000-8000-000000000001";
const ADMIN = "10000000-0000-4000-8000-00000000000a";
const OTHER = "10000000-0000-4000-8000-00000000000b";
const PADROOT = "10000000-0000-4000-8000-00000000000c";
let db: PGlite;
const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};
const home = async (user: string) =>
  (
    await db.query<{ id: string }>(
      "select id from workspaces where created_by=$1 order by created_at limit 1",
      [user],
    )
  ).rows[0].id;

describe("workspace lifecycle", () => {
  beforeAll(async () => {
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
    for (const u of [ADMIN, OWNER, OTHER, PADROOT])
      await db.query("insert into auth.users(id) values ($1)", [u]);
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      ADMIN,
    ]);
    await db.query(
      "update subscriptions set plan_key='owner' where workspace_id=$1",
      [await home(ADMIN)],
    );
    await db.query(
      "update subscriptions set plan_key='agency' where workspace_id=$1",
      [await home(OWNER)],
    );
  });

  it("the owner renames a workspace; a member who is not the owner cannot", async () => {
    const w = await home(OWNER);
    await as(OWNER);
    await db.query("select rename_workspace($1,'  قناة الأخبار  ')", [w]);
    await db.exec("reset role");
    const r = await db.query<{ name: string }>(
      "select name from workspaces where id=$1",
      [w],
    );
    expect(r.rows[0].name).toBe("قناة الأخبار");
    await db.query("insert into memberships values ($1,$2,'analyst')", [
      w,
      OTHER,
    ]);
    await as(OTHER);
    await expect(
      db.query("select rename_workspace($1,'x')", [w]),
    ).rejects.toThrow(/forbidden/);
    await as(OWNER);
    await expect(
      db.query("select rename_workspace($1,'   ')", [w]),
    ).rejects.toThrow(/invalid_name/);
    await db.exec("reset role");
    const a = await db.query<{ action: string; target_id: string }>(
      "select action,target_id from audit_events where workspace_id=$1 order by created_at desc limit 1",
      [w],
    );
    expect(a.rows[0]).toEqual({
      action: "workspace_renamed",
      target_id: "قناة الأخبار",
    });
  });

  it("retiring a workspace keeps every row, removes the members, and hands it to the platform owner", async () => {
    await as(OWNER);
    await db.query("select create_workspace('client one')");
    await db.exec("reset role");
    const w = (
      await db.query<{ id: string }>(
        "select id from workspaces where name='client one'",
      )
    ).rows[0].id;
    await db.query("insert into memberships values ($1,$2,'viewer')", [
      w,
      OTHER,
    ]);
    await db.query(
      `insert into channels(id,workspace_id,client_id,external_channel_id,status)
       values ($1,$1,(select id from clients where workspace_id=$1),'UC${"c".repeat(22)}','connected')`,
      [w],
    );
    await db.query(
      `insert into private.oauth_connections(workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
       values ($1,$1,$2,'\\x00','v1','{}','active')`,
      [w, OWNER],
    );
    await db.query(
      `insert into videos(id,workspace_id,channel_id,external_video_id,title) values ($1,$1,$1,'aaaaaaaaaaa','v')`,
      [w],
    );
    await db.query(
      `insert into jobs(workspace_id,channel_id,type,dedupe_key,status) values ($1,$1,'collect','k','queued')`,
      [w],
    );

    await as(OTHER);
    await expect(db.query("select retire_workspace($1)", [w])).rejects.toThrow(
      /forbidden/,
    );
    await as(OWNER);
    await db.query("select retire_workspace($1)", [w]);
    await db.exec("reset role");

    const adminHome = await home(ADMIN);
    const m = await db.query<{ user_id: string; role: string }>(
      "select user_id,role from memberships where workspace_id=$1",
      [w],
    );
    expect(m.rows).toEqual([{ user_id: ADMIN, role: "workspace_owner" }]);
    const ws = await db.query<{
      created_by: string;
      retired_from: string;
      retired_at: string | null;
    }>(
      "select created_by,retired_from,retired_at from workspaces where id=$1",
      [w],
    );
    expect(ws.rows[0].created_by).toBe(ADMIN);
    expect(ws.rows[0].retired_from).toBe(OWNER);
    expect(ws.rows[0].retired_at).not.toBeNull();
    const s = await db.query<{
      plan_key: string;
      billing_workspace_id: string;
    }>(
      "select plan_key,billing_workspace_id from subscriptions where workspace_id=$1",
      [w],
    );
    expect(s.rows[0]).toEqual({
      plan_key: "owner",
      billing_workspace_id: adminHome,
    });
    const ch = await db.query<{ status: string }>(
      "select status from channels where workspace_id=$1",
      [w],
    );
    expect(ch.rows[0].status).toBe("disconnected");
    const g = await db.query<{ status: string }>(
      "select status from private.oauth_connections where workspace_id=$1",
      [w],
    );
    expect(g.rows[0].status).toBe("revoked");
    const j = await db.query<{ status: string; error_code: string }>(
      "select status,error_code from jobs where workspace_id=$1",
      [w],
    );
    expect(j.rows[0]).toEqual({
      status: "cancelled",
      error_code: "disconnected",
    });
    // Nothing collected is gone.
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from videos where workspace_id=$1",
          [w],
        )
      ).rows[0].n,
    ).toBe(1);
    const a = await db.query<{ action: string }>(
      "select action from audit_events where workspace_id=$1 order by created_at desc limit 1",
      [w],
    );
    expect(a.rows[0].action).toBe("workspace_retired");
    // The former owner no longer sees it.
    await as(OWNER);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int as n from workspaces where id=$1",
          [w],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("the last workspace a user owns cannot be retired", async () => {
    const w = await home(OWNER);
    await as(OWNER);
    await expect(db.query("select retire_workspace($1)", [w])).rejects.toThrow(
      /last_workspace/,
    );
  });

  it("the platform owner cannot retire a workspace to themself", async () => {
    await as(ADMIN);
    await db.query("select create_workspace('owner spare')");
    await db.exec("reset role");
    const w = (
      await db.query<{ id: string }>(
        "select id from workspaces where name='owner spare'",
      )
    ).rows[0].id;
    await as(ADMIN);
    await expect(db.query("select retire_workspace($1)", [w])).rejects.toThrow(
      /owner_cannot_retire/,
    );
    await db.exec("reset role");
    // Nothing moved: still the admin's, still a member.
    const m = await db.query<{ user_id: string }>(
      "select user_id from memberships where workspace_id=$1",
      [w],
    );
    expect(m.rows).toEqual([{ user_id: ADMIN }]);
  });

  it("delete_workspace is the operator's door only", async () => {
    const w = await home(OWNER);
    await as(OWNER);
    await expect(db.query("select delete_workspace($1)", [w])).rejects.toThrow(
      /forbidden/,
    );
    await expect(
      db.query("select admin_workspace_footprint($1)", [w]),
    ).rejects.toThrow(/forbidden/);
    await db.exec("reset role");
  });

  it("delete_workspace refuses a billing root, an active Paddle subscription, and the admin's last workspace", async () => {
    // A billing root: 'client one' was retired earlier in this file and now
    // bills under the admin's home. The admin owns more than one workspace
    // at this point, so the refusal is billing_root, not last_workspace.
    const adminHome = await home(ADMIN);
    await as(ADMIN);
    await expect(
      db.query("select delete_workspace($1)", [adminHome]),
    ).rejects.toThrow(/billing_root/);
    await db.exec("reset role");
    // Nothing moved: the admin's home, its membership, and its subscription
    // are all still there.
    const adminHomeStill = await db.query<{ n: number }>(
      "select count(*) n from workspaces where id=$1",
      [adminHome],
    );
    expect(adminHomeStill.rows[0].n).toBe(1);
    const adminHomeMembers = await db.query<{ n: number }>(
      "select count(*) n from memberships where workspace_id=$1",
      [adminHome],
    );
    expect(adminHomeMembers.rows[0].n).toBe(1);
    const adminHomeSub = await db.query<{ n: number }>(
      "select count(*) n from subscriptions where workspace_id=$1",
      [adminHome],
    );
    expect(adminHomeSub.rows[0].n).toBe(1);

    // A workspace Paddle is billing.
    await as(OWNER);
    await db.query("select create_workspace('paid')");
    await db.exec("reset role");
    const paid = (
      await db.query<{ id: string }>(
        "select id from workspaces where name='paid'",
      )
    ).rows[0].id;
    // 'paid' was created after OWNER's home existed, so create_workspace_impl
    // made it a client billing under that home; null the pointer to make it
    // a root in its own right, the case this refusal is actually about.
    await db.query(
      "update subscriptions set provider='paddle', provider_ref='sub_1', status='active', billing_workspace_id=null where workspace_id=$1",
      [paid],
    );
    await as(ADMIN);
    await expect(
      db.query("select delete_workspace($1)", [paid]),
    ).rejects.toThrow(/paddle_subscription_active/);
    await db.exec("reset role");
    const still = await db.query<{ n: number }>(
      "select count(*) n from workspaces where id=$1",
      [paid],
    );
    expect(still.rows[0].n).toBe(1);

    // A card in dunning is still a live Paddle subscription; deleting under
    // it would leave the customer billed for nothing.
    await db.query(
      "update subscriptions set status='past_due' where workspace_id=$1",
      [paid],
    );
    await as(ADMIN);
    await expect(
      db.query("select delete_workspace($1)", [paid]),
    ).rejects.toThrow(/paddle_subscription_active/);
    await db.exec("reset role");

    // The admin's own last workspace: a second admin who owns only their
    // bootstrap workspace.
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      OTHER,
    ]);
    await as(OTHER);
    const otherHome = await home(OTHER);
    await expect(
      db.query("select delete_workspace($1)", [otherHome]),
    ).rejects.toThrow(/last_workspace/);
    await db.exec("reset role");
    const otherHomeStill = await db.query<{ n: number }>(
      "select count(*) n from workspaces where id=$1",
      [otherHome],
    );
    expect(otherHomeStill.rows[0].n).toBe(1);
  });

  it("delete_workspace refuses paddle_subscription_active only for the billing root, not for its clients", async () => {
    // PADROOT is a fresh root with no client workspaces yet, so the
    // billing_root refusal cannot pre-empt the paddle check below.
    const root = await home(PADROOT);
    // 'agency' carries a workspaces_limit above one, so PADROOT can create a
    // second (client) workspace below.
    await db.query(
      "update subscriptions set provider='paddle', status='active', plan_key='agency' where workspace_id=$1",
      [root],
    );
    await as(PADROOT);
    await db.query("select create_workspace('padroot client')");
    await db.exec("reset role");
    const client = (
      await db.query<{ id: string }>(
        "select id from workspaces where name='padroot client'",
      )
    ).rows[0].id;
    const clientSub = await db.query<{
      billing_workspace_id: string;
      provider: string;
      status: string;
    }>(
      "select billing_workspace_id,provider,status from subscriptions where workspace_id=$1",
      [client],
    );
    // The client row copied the root's provider/status verbatim
    // (create_workspace_impl), which is exactly the trap the root-only guard
    // avoids.
    expect(clientSub.rows[0]).toEqual({
      billing_workspace_id: root,
      provider: "paddle",
      status: "active",
    });

    await as(ADMIN);
    await db.query("select delete_workspace($1)", [client]);
    await db.exec("reset role");
    const clientGone = await db.query<{ n: number }>(
      "select count(*) n from workspaces where id=$1",
      [client],
    );
    expect(clientGone.rows[0].n).toBe(0);

    // The root itself is still refused — now with nothing billing under it,
    // so the refusal is paddle_subscription_active, not billing_root.
    await as(ADMIN);
    await expect(
      db.query("select delete_workspace($1)", [root]),
    ).rejects.toThrow(/paddle_subscription_active/);
    await db.exec("reset role");
    const rootStill = await db.query<{ n: number }>(
      "select count(*) n from workspaces where id=$1",
      [root],
    );
    expect(rootStill.rows[0].n).toBe(1);
  });

  it("delete_workspace removes every row of one workspace, no row of another, and records the act on the admin's home", async () => {
    // Build a full workspace: channel, grant, video, two comments, a run, a
    // prediction, a review, a job, a usage grant, a topic.
    await as(OWNER);
    await db.query("select create_workspace('doomed')");
    await db.query("select create_workspace('neighbour')");
    await db.exec("reset role");
    const id = async (name: string) =>
      (
        await db.query<{ id: string }>(
          "select id from workspaces where name=$1",
          [name],
        )
      ).rows[0].id;
    const d = await id("doomed");
    const n = await id("neighbour");
    for (const w of [d, n]) {
      // Each workspace's claim must be a distinct external channel: the
      // unique index only allows one connected claim per external id.
      const externalChannelId = "UC" + w.replace(/-/g, "").slice(0, 22);
      await db.query(
        `insert into channels(id,workspace_id,client_id,external_channel_id,status)
         values ($1,$1,(select id from clients where workspace_id=$1),$2,'connected')`,
        [w, externalChannelId],
      );
      await db.query(
        `insert into private.oauth_connections(workspace_id,channel_id,connected_by,encrypted_tokens,key_version,granted_scopes,status)
         values ($1,$1,$2,'\\x00','v1','{}','active')`,
        [w, OWNER],
      );
      await db.query(
        `insert into videos(id,workspace_id,channel_id,external_video_id,title) values ($1,$1,$1,'vvvvvvvvvvv','v')`,
        [w],
      );
      await db.query(
        `insert into comments(id,workspace_id,video_id,external_comment_id,text_raw,text_plain,
          content_hash,timestamp_precision,source,author_name,likes_raw,likes_value,published_at)
         values (gen_random_uuid(),$1,$1,'c1','نص','نص','h1','second',
                 'youtube_data_api_public','مؤلف','1',1,'2026-09-01T09:00:00Z')`,
        [w],
      );
      await db.query(
        `insert into analysis_runs(id,workspace_id,model_id,revision_sha,preprocessing_version,parameters,status)
         values ($1,$1,'m','rev','v1','{}','succeeded')`,
        [w],
      );
      await db.query(
        `insert into sentiment_predictions(workspace_id,comment_id,content_hash,analysis_run_id,analysis_key,status,label,class_scores)
         select $1, c.id, 'h1', $1, 'm@rev+v1+p', 'succeeded', 'positive', '{"positive":0.9}'
           from comments c where c.workspace_id=$1`,
        [w],
      );
      await db.query(
        `insert into jobs(workspace_id,channel_id,type,dedupe_key,status) values ($1,$1,'collect','k','queued')`,
        [w],
      );
      await db.query(
        `insert into audit_events(workspace_id,actor_id,action,target_type,target_id) values ($1,$2,'seeded','test','x')`,
        [w, OWNER],
      );
      // A webhook's trail: detached, not deleted, so a chargeback dispute
      // raised after the workspace is gone still has something to read.
      await db.query(
        `insert into private.billing_events(event_id,event_type,occurred_at,workspace_id,outcome,payload)
         values ($2,'subscription.created',now(),$1,'applied','{}'::jsonb)`,
        [w, `evt-${w}`],
      );
    }
    const totalBillingEvents = (
      await db.query<{ n: string }>(
        "select count(*) n from private.billing_events",
      )
    ).rows[0].n;
    const tables = [
      "channels",
      "private.oauth_connections",
      "videos",
      "comments",
      "analysis_runs",
      "sentiment_predictions",
      "jobs",
      "audit_events",
      "memberships",
      "subscriptions",
      "clients",
      "workspaces",
    ];
    const count = async (t: string, w: string) =>
      Number(
        (
          await db.query<{ n: string }>(
            `select count(*) n from ${t} where ${t === "workspaces" ? "id" : "workspace_id"}=$1`,
            [w],
          )
        ).rows[0].n,
      );
    const before = Object.fromEntries(
      await Promise.all(tables.map(async (t) => [t, await count(t, n)])),
    );
    expect(before.comments).toBe(1);

    await as(ADMIN);
    const fp = await db.query<{
      admin_workspace_footprint: Record<string, number>;
    }>("select admin_workspace_footprint($1)", [d]);
    expect(fp.rows[0].admin_workspace_footprint).toEqual({
      channels: 1,
      videos: 1,
      comments: 1,
      predictions: 1,
      reviews: 0,
      members: 1,
    });
    await db.query("select delete_workspace($1)", [d]);
    await db.exec("reset role");

    for (const t of tables) expect(await count(t, d), t).toBe(0);
    for (const t of tables) expect(await count(t, n), t).toBe(before[t]);
    // billing_events is detached, not deleted: no row still names the
    // deleted workspace, but the rows themselves — the webhook trail — are
    // all still there, by id, for later chargeback disputes.
    expect(await count("private.billing_events", d)).toBe(0);
    const billingEventsAfter = (
      await db.query<{ n: string }>(
        "select count(*) n from private.billing_events",
      )
    ).rows[0].n;
    expect(billingEventsAfter).toBe(totalBillingEvents);
    // The audit trail is detached, not deleted (review finding 6): the
    // seeded row survives, names no workspace, and remembers which it was.
    const kept = await db.query<{
      action: string;
      workspace_id: string | null;
    }>(
      "select action, workspace_id from audit_events where former_workspace_id=$1",
      [d],
    );
    expect(kept.rows).toEqual([{ action: "seeded", workspace_id: null }]);
    const adminHome = await home(ADMIN);
    const a = await db.query<{
      action: string;
      target_id: string;
      actor_id: string;
    }>(
      "select action,target_id,actor_id from audit_events where workspace_id=$1 order by created_at desc limit 1",
      [adminHome],
    );
    expect(a.rows[0]).toEqual({
      action: "workspace_deleted",
      target_id: d,
      actor_id: ADMIN,
    });
  });

  it("the append-only guard yields only to delete_workspace, for only that workspace", async () => {
    await as(OWNER);
    await db.query("select create_workspace('guarded')");
    await db.exec("reset role");
    const g = (
      await db.query<{ id: string }>(
        "select id from workspaces where name='guarded'",
      )
    ).rows[0].id;
    await db.query(
      `insert into audit_events(workspace_id,actor_id,action,target_type,target_id) values ($1,$2,'seeded','test','x')`,
      [g, OWNER],
    );
    // Outside delete_workspace, even the superuser session cannot delete or update an audit row.
    await expect(
      db.query("delete from audit_events where workspace_id=$1", [g]),
    ).rejects.toThrow(/append_only/);
    await expect(
      db.query(
        "update audit_events set action='edited' where workspace_id=$1",
        [g],
      ),
    ).rejects.toThrow(/append_only/);
    // Setting the GUC by hand for a DIFFERENT workspace does not open this one.
    await db.query("select set_config('app.deleting_workspace',$1,false)", [
      await home(OWNER),
    ]);
    await expect(
      db.query("delete from audit_events where workspace_id=$1", [g]),
    ).rejects.toThrow(/append_only/);
    // Even with the GUC set for THIS workspace, an audit row is never
    // deleted, and the one update allowed is the detach, nothing else.
    await db.query("select set_config('app.deleting_workspace',$1,false)", [g]);
    await expect(
      db.query("delete from audit_events where workspace_id=$1", [g]),
    ).rejects.toThrow(/append_only/);
    await expect(
      db.query(
        "update audit_events set workspace_id=null, former_workspace_id=$1, action='edited' where workspace_id=$1",
        [g],
      ),
    ).rejects.toThrow(/append_only/);
    await expect(
      db.query(
        "update audit_events set workspace_id=null, former_workspace_id=gen_random_uuid() where workspace_id=$1",
        [g],
      ),
    ).rejects.toThrow(/append_only/);
    await db.query("select set_config('app.deleting_workspace','',false)");
    // The other leg: even with the GUC set for THIS workspace, a tenant role
    // holds no DELETE grant on audit_events at all — the grant check fails
    // before the trigger is ever consulted.
    await as(OWNER);
    await db.query("select set_config('app.deleting_workspace',$1,false)", [g]);
    await expect(
      db.query("delete from audit_events where workspace_id=$1", [g]),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    // Session-wide GUC, left set by the query above (set_config's third
    // argument is false): reset so it does not leak into a later test.
    await db.query("select set_config('app.deleting_workspace','',false)");
  });
});
