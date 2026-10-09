/**
 * The owner's account file: `admin_user_detail`, `admin_update_user_profile`
 * and `admin_record_user_action`.
 *
 * Only a platform admin reads or edits a person's details; every edit lands
 * in the audit trail and shows in that person's history; the details table
 * is out of the browser's reach.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdminAuditEventsSchema,
  AdminUserDetailSchema,
} from "@sentiment/contracts";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const CUSTOMER = "10000000-0000-4000-8000-000000000002";
const HOME = "00000000-0000-4000-8000-000000000001";
const SHOP = "00000000-0000-4000-8000-000000000002";
let db: PGlite;

type Detail = {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  banned_until: string | null;
  profile: {
    display_name: string | null;
    organization: string | null;
    phone: string | null;
    admin_note: string | null;
  };
  memberships: {
    workspace_id: string;
    workspace_name: string;
    role: string;
    created_by_user: boolean;
  }[];
  history: { action: string; actor_email: string | null; by_self: boolean }[];
};

async function as(role: "authenticated" | "anon", sub: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    sub ?? "",
  ]);
  await db.exec(`set role ${role}`);
}

async function detail(user: string): Promise<Detail> {
  const { rows } = await db.query<{ r: Detail }>(
    "select public.admin_user_detail($1) as r",
    [user],
  );
  return rows[0]!.r;
}

async function saveProfile(
  user: string,
  name: string | null,
  org: string | null,
  phone: string | null,
  note: string | null,
) {
  await db.query("select public.admin_update_user_profile($1,$2,$3,$4,$5)", [
    user,
    name,
    org,
    phone,
    note,
  ]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz, email_confirmed_at timestamptz, banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));

  await db.query(
    `insert into auth.users(id,email,email_confirmed_at) values
       ($1,'owner@example.com',now()),($2,'customer@example.com',null)`,
    [ADMIN, CUSTOMER],
  );
  await db.query("insert into private.platform_admins(user_id) values ($1)", [
    ADMIN,
  ]);
  await db.query(
    `insert into workspaces(id,name,created_by) values ($1,'Home',$3),($2,'Shop',$4)`,
    [HOME, SHOP, ADMIN, CUSTOMER],
  );
  await db.query(
    `insert into memberships values ($1,$3,'workspace_owner'),($2,$4,'workspace_owner'),($1,$4,'analyst')`,
    [HOME, SHOP, ADMIN, CUSTOMER],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("admin_user_detail", () => {
  it("shows a person's sign-in facts, empty details, and every workspace they stand in", async () => {
    await as("authenticated", ADMIN);
    const d = await detail(CUSTOMER);
    expect(d.email).toBe("customer@example.com");
    expect(d.email_confirmed_at).toBeNull();
    expect(d.banned_until).toBeNull();
    expect(d.profile).toMatchObject({
      display_name: null,
      organization: null,
      phone: null,
      admin_note: null,
    });
    // Signing up also made each person a personal workspace; the two this
    // file made are the ones checked.
    expect(
      d.memberships.filter((m) => [HOME, SHOP].includes(m.workspace_id)),
    ).toEqual([
      {
        workspace_id: HOME,
        workspace_name: "Home",
        role: "analyst",
        created_by_user: false,
      },
      {
        workspace_id: SHOP,
        workspace_name: "Shop",
        role: "workspace_owner",
        created_by_user: true,
      },
    ]);
    expect(d.history).toEqual([]);
  });

  it("answers an unknown person with user_not_found", async () => {
    await as("authenticated", ADMIN);
    await expect(
      detail("10000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow(/user_not_found/);
  });

  it("refuses everyone but a platform admin", async () => {
    await as("authenticated", CUSTOMER);
    await expect(detail(ADMIN)).rejects.toThrow(/forbidden/);
    await as("anon", null);
    await expect(detail(CUSTOMER)).rejects.toThrow(/permission denied/);
  });
});

describe("admin_update_user_profile", () => {
  it("saves the details, trimmed, and the edit shows in the person's history", async () => {
    await as("authenticated", ADMIN);
    await saveProfile(
      CUSTOMER,
      "  سارة أحمد ",
      "متجر الأزياء",
      "+966 500 000 000",
      "Invoice in the company's name",
    );
    const d = await detail(CUSTOMER);
    expect(d.profile).toMatchObject({
      display_name: "سارة أحمد",
      organization: "متجر الأزياء",
      phone: "+966 500 000 000",
      admin_note: "Invoice in the company's name",
    });
    expect(d.history[0]).toMatchObject({
      action: "user_profile_updated",
      actor_email: "owner@example.com",
      by_self: false,
    });
  });

  it("clears a field left blank", async () => {
    await as("authenticated", ADMIN);
    await saveProfile(CUSTOMER, "سارة أحمد", "  ", null, "");
    const d = await detail(CUSTOMER);
    expect(d.profile).toMatchObject({
      display_name: "سارة أحمد",
      organization: null,
      phone: null,
      admin_note: null,
    });
  });

  it("refuses a field longer than it may be", async () => {
    await as("authenticated", ADMIN);
    await expect(
      saveProfile(CUSTOMER, "x".repeat(121), null, null, null),
    ).rejects.toThrow(/profile_too_long/);
  });

  it("refuses everyone but a platform admin, and the table is out of the browser's reach", async () => {
    await as("authenticated", CUSTOMER);
    await expect(saveProfile(CUSTOMER, "Me", null, null, null)).rejects.toThrow(
      /forbidden/,
    );
    await expect(
      db.query("select * from private.user_profiles"),
    ).rejects.toThrow(/permission denied/);
    await as("anon", null);
    await expect(
      saveProfile(CUSTOMER, "Anon", null, null, null),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("a role change in the account file", () => {
  it("goes through the share dialog's own function and shows in the person's history", async () => {
    await as("authenticated", ADMIN);
    await db.query(
      "select public.update_workspace_account_role($1,$2,'viewer')",
      [HOME, CUSTOMER],
    );
    const d = await detail(CUSTOMER);
    expect(d.memberships.find((m) => m.workspace_id === HOME)?.role).toBe(
      "viewer",
    );
    expect(d.history[0]).toMatchObject({
      action: "workspace_account_role_updated",
      actor_email: "owner@example.com",
    });
    // The owner's seat is not one the file changes.
    await expect(
      db.query("select public.update_workspace_account_role($1,$2,'viewer')", [
        SHOP,
        CUSTOMER,
      ]),
    ).rejects.toThrow(/cannot_modify_owner/);
  });
});

describe("the account file's rows, as the pages read them", () => {
  it("the detail matches its contract, and the trail page still reads an event that names no workspace", async () => {
    await as("authenticated", ADMIN);
    AdminUserDetailSchema.parse(await detail(CUSTOMER));
    const { rows } = await db.query<{ r: unknown }>(
      "select public.admin_audit(100) as r",
    );
    const events = AdminAuditEventsSchema.parse(rows.map((r) => r.r));
    expect(
      events.find((e) => e.action === "user_profile_updated"),
    ).toMatchObject({ workspace_id: null, workspace_name: "Platform" });
  });
});

describe("admin_record_user_action", () => {
  it("records a reset link sent, and nothing it does not know", async () => {
    await as("authenticated", ADMIN);
    await db.query("select public.admin_record_user_action($1,$2)", [
      CUSTOMER,
      "password_reset_sent",
    ]);
    expect((await detail(CUSTOMER)).history[0]!.action).toBe(
      "password_reset_sent",
    );
    await expect(
      db.query("select public.admin_record_user_action($1,$2)", [
        CUSTOMER,
        "user_deleted",
      ]),
    ).rejects.toThrow(/invalid_action/);
    await as("authenticated", CUSTOMER);
    await expect(
      db.query("select public.admin_record_user_action($1,$2)", [
        ADMIN,
        "password_reset_sent",
      ]),
    ).rejects.toThrow(/forbidden/);
  });
});

describe("admin_user_target (the admin-users function's gate)", () => {
  async function target(user: string) {
    const { rows } = await db.query<{
      r: { email: string | null; is_admin: boolean; is_self: boolean };
    }>("select public.admin_user_target($1) as r", [user]);
    return rows[0]!.r;
  }

  it("names the person, and whether they are an admin or the caller", async () => {
    await as("authenticated", ADMIN);
    expect(await target(CUSTOMER)).toEqual({
      email: "customer@example.com",
      is_admin: false,
      is_self: false,
    });
    expect(await target(ADMIN)).toEqual({
      email: "owner@example.com",
      is_admin: true,
      is_self: true,
    });
    await expect(
      target("10000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow(/user_not_found/);
  });

  it("answers no one but a platform admin", async () => {
    await as("authenticated", CUSTOMER);
    await expect(target(ADMIN)).rejects.toThrow(/forbidden/);
    await as("anon", null);
    await expect(target(CUSTOMER)).rejects.toThrow(/permission denied/);
  });

  it("the trail learns the function's actions", async () => {
    await as("authenticated", ADMIN);
    for (const action of [
      "password_link_created",
      "user_suspended",
      "user_unsuspended",
      "email_confirmed",
      "email_changed",
    ])
      await db.query("select public.admin_record_user_action($1,$2)", [
        CUSTOMER,
        action,
      ]);
    expect(
      (await detail(CUSTOMER)).history.slice(0, 5).map((h) => h.action),
    ).toEqual(
      expect.arrayContaining([
        "password_link_created",
        "user_suspended",
        "user_unsuspended",
        "email_confirmed",
        "email_changed",
      ]),
    );
  });
});
