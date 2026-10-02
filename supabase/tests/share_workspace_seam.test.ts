/**
 * Seam test verifying that the RPC argument builder exported by ShareWorkspaceDialog
 * produces exact parameter names and types accepted by Postgres functions:
 *   - public.share_workspace(w, account_email, account_role)
 *   - public.update_workspace_account_role(w, target_user_id, new_role)
 *   - public.unshare_workspace(w, target_user_id)
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildShareWorkspaceRpcArgs } from "../../apps/web/src/account/ShareWorkspaceDialog";

const OWNER = "20000000-0000-4000-8000-000000000001";
const ALICE = "20000000-0000-4000-8000-000000000002";

let db: PGlite;
let ownerWs: string;

const asUser = async (userId: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    userId,
  ]);
  await db.exec("set role authenticated");
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
  `);

  await db.exec(`
    create function public.__pgrst_probe() returns int language sql as 'select 42';
    create function public.__pgrst_probe2(text) returns int language sql as 'select 42';
    create function public.__pgrst_probe2(text, text[]) returns int language sql as 'select 42';
  `);

  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  }

  await db.exec("reset role");
  await db.query(
    "insert into auth.users(id, email) values ($1, $2), ($3, $4)",
    [OWNER, "owner@example.com", ALICE, "alice@example.com"],
  );

  const wsRes = await db.query<{ id: string }>(
    "select id from public.workspaces where created_by = $1",
    [OWNER],
  );
  ownerWs = wsRes.rows[0].id;
  await db.query(
    "update subscriptions set plan_key='creator_plus', status='active' where workspace_id=$1",
    [ownerWs],
  );
});

describe("ShareWorkspaceDialog RPC arg builder seam with Postgres", () => {
  it("executes share_workspace using buildShareWorkspaceRpcArgs output", async () => {
    await asUser(OWNER);

    const shareArgs = buildShareWorkspaceRpcArgs("share_workspace", {
      w: ownerWs,
      account_email: "alice@example.com",
      account_role: "analyst",
    });

    // In PostgREST, rpc("share_workspace", args) invokes share_workspace(w => ..., account_email => ..., account_role => ...)
    const res = await db.query<{ share_workspace: { ok: boolean } }>(
      "select public.share_workspace(w => $1, account_email => $2, account_role => $3)",
      [shareArgs.w, shareArgs.account_email, shareArgs.account_role],
    );

    expect(res.rows[0].share_workspace.ok).toBe(true);

    // Verify membership was created
    const memRes = await db.query<{ role: string }>(
      "select role from public.memberships where workspace_id = $1 and user_id = $2",
      [ownerWs, ALICE],
    );
    expect(memRes.rows).toHaveLength(1);
    expect(memRes.rows[0].role).toBe("analyst");
  });

  it("executes update_workspace_account_role using buildShareWorkspaceRpcArgs output", async () => {
    await asUser(OWNER);

    const updateArgs = buildShareWorkspaceRpcArgs(
      "update_workspace_account_role",
      {
        w: ownerWs,
        target_user_id: ALICE,
        new_role: "viewer",
      },
    );

    const res = await db.query<{
      update_workspace_account_role: { ok: boolean };
    }>(
      "select public.update_workspace_account_role(w => $1, target_user_id => $2, new_role => $3)",
      [updateArgs.w, updateArgs.target_user_id, updateArgs.new_role],
    );

    expect(res.rows[0].update_workspace_account_role.ok).toBe(true);

    const memRes = await db.query<{ role: string }>(
      "select role from public.memberships where workspace_id = $1 and user_id = $2",
      [ownerWs, ALICE],
    );
    expect(memRes.rows[0].role).toBe("viewer");
  });

  it("executes unshare_workspace using buildShareWorkspaceRpcArgs output", async () => {
    await asUser(OWNER);

    const unshareArgs = buildShareWorkspaceRpcArgs("unshare_workspace", {
      w: ownerWs,
      target_user_id: ALICE,
    });

    const res = await db.query<{ unshare_workspace: { ok: boolean } }>(
      "select public.unshare_workspace(w => $1, target_user_id => $2)",
      [unshareArgs.w, unshareArgs.target_user_id],
    );

    expect(res.rows[0].unshare_workspace.ok).toBe(true);

    const memRes = await db.query<{ role: string }>(
      "select role from public.memberships where workspace_id = $1 and user_id = $2",
      [ownerWs, ALICE],
    );
    expect(memRes.rows).toHaveLength(0);
  });
});
