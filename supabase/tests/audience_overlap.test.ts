import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const W1 = "00000000-0000-4000-8000-0000000000a1";
const W2 = "00000000-0000-4000-8000-0000000000b1";
const U1 = "10000000-0000-4000-8000-0000000000a1";
const U2 = "10000000-0000-4000-8000-0000000000b1";
const A = "20000000-0000-4000-8000-0000000000a1";
const B = "20000000-0000-4000-8000-0000000000a2";
const D = "20000000-0000-4000-8000-0000000000a4";
const C = "20000000-0000-4000-8000-0000000000b1";
let db: PGlite;

const as = async (user: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
};
const n = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: string }>(sql, params)).rows[0].n);
const refresh = async () => n("select private.refresh_audience_overlap() n");
const pairMembers = async (aCount: number, bCount: number, shared: number) => {
  await db.query(
    `insert into private.audience_members(workspace_id,channel_id,member_hash,first_seen_at,last_seen_at,comment_count,is_suspected_bot)
     select $1,$2,decode(lpad(to_hex(i),64,'0'),'hex'),now(),now(),1,false from generate_series(1,$3) i`,
    [W1, A, aCount],
  );
  await db.query(
    `insert into private.audience_members(workspace_id,channel_id,member_hash,first_seen_at,last_seen_at,comment_count,is_suspected_bot)
     select $1,$2,decode(lpad(to_hex(case when i <= $4 then i else 10000+i end),64,'0'),'hex'),now(),now(),1,false from generate_series(1,$3) i`,
    [W1, B, bCount, shared],
  );
};
const result = async (channel = A) =>
  (
    await db.query<{ audience_overlap: unknown }>(
      "select public.audience_overlap($1) audience_overlap",
      [channel],
    )
  ).rows[0].audience_overlap as {
    status: string;
    channel: { audience_size: number | null };
    others: Array<Record<string, unknown>>;
  };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [U1, U2]);
  for (const [w, u] of [
    [W1, U1],
    [W2, U2],
  ]) {
    await db.query(
      "insert into workspaces(id,name,created_by) values($1,'workspace',$2)",
      [w, u],
    );
    await db.query(
      "insert into memberships(workspace_id,user_id,role) values($1,$2,'workspace_owner')",
      [w, u],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values($1,$1,'client')",
      [w],
    );
  }
  for (const [id, w, external] of [
    [A, W1, "UC_a"],
    [B, W1, "UC_b"],
    [C, W2, "UC_c"],
  ])
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,title) values($1,$2,$2,$3,$3)",
      [id, w, external],
    );
  await db.query(
    "alter table public.channels drop constraint channels_platform_check",
  );
  await db.query(
    "insert into channels(id,workspace_id,client_id,external_channel_id,title,platform) values('20000000-0000-4000-8000-0000000000a3',$1,$1,'IG_x','Instagram','instagram')",
    [W1],
  );
  for (const [w, plan] of [
    [W1, "agency"],
    [W2, "agency"],
  ])
    await db.query(
      "insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values($1,$2,'active',now()-interval '1 day',now()+interval '30 days')",
      [w, plan],
    );
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec("reset role");
  await db.exec(
    "truncate private.audience_overlap_history,private.audience_overlap_cells,private.audience_sizes,private.audience_universe,private.audience_members",
  );
  await db.query(
    "update private.platform_switches set enabled=false where key='audience_overlap'",
  );
  await db.query(
    "update subscriptions set plan_key='agency' where workspace_id in ($1,$2)",
    [W1, W2],
  );
});

describe("audience overlap", () => {
  it("gates direct RPC access by membership, switch, plan and database role", async () => {
    await as(U1);
    await expect(
      db.query("select public.audience_overlap($1)", [A]),
    ).rejects.toThrow(/feature_unavailable/);
    await expect(
      db.query("select public.audience_overlap($1)", [C]),
    ).rejects.toThrow(/forbidden/);
    await expect(
      db.query("select public.audience_overlap_available($1)", [W2]),
    ).rejects.toThrow(/forbidden/);
    await db.exec("reset role");
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    await db.query(
      "update subscriptions set plan_key='creator' where workspace_id=$1",
      [W1],
    );
    await as(U1);
    await expect(
      db.query("select public.audience_overlap($1)", [A]),
    ).rejects.toThrow(/plan_feature_unavailable/);
    await db.exec("reset role");
    await db.query(
      "update subscriptions set plan_key='agency' where workspace_id=$1",
      [W1],
    );
    expect((await result()).status).toBe("pending");
    await db.exec("reset role; set role anon");
    await expect(
      db.query("select public.audience_overlap($1)", [A]),
    ).rejects.toThrow();
    await expect(
      db.query("select public.audience_overlap_available($1)", [W1]),
    ).rejects.toThrow();
    await db.exec("reset role");
    await db.query(
      "update subscriptions set plan_key='owner' where workspace_id=$1",
      [W1],
    );
    await as(U1);
    expect(
      (await db.query("select public.audience_overlap_available($1)", [W1]))
        .rows[0],
    ).toMatchObject({
      audience_overlap_available: { switch_on: true, plan_allows: true },
    });
    expect((await result()).status).toBe("pending");
  });

  it("refreshes tenant-local counts, thresholds, ratios, Wilson interval and bot exclusions", async () => {
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    await pairMembers(200, 50, 20);
    await db.query(
      "insert into private.audience_members(workspace_id,channel_id,member_hash,first_seen_at,last_seen_at,comment_count,is_suspected_bot) values($1,$2,decode(lpad(to_hex(99999),64,'0'),'hex'),now(),now(),1,true),($1,$3,decode(lpad(to_hex(99999),64,'0'),'hex'),now(),now(),1,true)",
      [W1, A, B],
    );
    expect(await refresh()).toBe(1);
    expect(
      await n(
        "select size n from private.audience_universe where workspace_id=$1 and platform='youtube'",
        [W1],
      ),
    ).toBe(230);
    await db.query(
      "update private.audience_universe set size=1000 where workspace_id=$1 and platform='youtube'",
      [W1],
    );
    await as(U1);
    const data = await result();
    expect(data.status).toBe("ready");
    expect(data.channel.audience_size).toBe(200);
    expect(data.others).toHaveLength(1);
    expect(data.others[0]).toMatchObject({
      audience_size: 50,
      below_threshold: false,
      shared: 20,
      share_of_mine: 0.1,
      share_of_theirs: 0.4,
      overlap_coefficient: 0.4,
      affinity: 200,
    });
    expect(data.others[0].share_of_mine_ci).toEqual({
      low: 0.0657,
      high: 0.1494,
    });
  });

  it("clears a workspace whose members have all aged out", async () => {
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    await pairMembers(200, 50, 20);
    await refresh();
    expect(
      await n(
        "select count(*) n from private.audience_overlap_cells where workspace_id=$1",
        [W1],
      ),
    ).toBe(1);
    await db.query(
      "delete from private.audience_members where workspace_id=$1",
      [W1],
    );
    await refresh();
    expect(
      await n(
        "select count(*) n from private.audience_overlap_cells where workspace_id=$1",
        [W1],
      ),
    ).toBe(0);
    expect(
      await n(
        "select coalesce(sum(size),0) n from private.audience_sizes where workspace_id=$1",
        [W1],
      ),
    ).toBe(0);
  });

  it("returns null measures below thresholds and lists only same-platform channels", async () => {
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    await pairMembers(99, 50, 20);
    await refresh();
    await as(U1);
    const small = await result();
    expect(small.others[0]).toMatchObject({
      below_threshold: true,
      shared: null,
      share_of_mine: null,
      share_of_theirs: null,
      overlap_coefficient: null,
      affinity: null,
      share_of_mine_ci: null,
    });
    await db.exec("reset role");
    await db.query(
      "truncate private.audience_overlap_history,private.audience_overlap_cells,private.audience_sizes,private.audience_universe,private.audience_members",
    );
    await pairMembers(100, 50, 9);
    await refresh();
    await as(U1);
    expect((await result()).others[0]).toMatchObject({
      below_threshold: true,
      shared: null,
    });
    await db.exec("reset role");
    await db.query(
      "truncate private.audience_overlap_history,private.audience_overlap_cells,private.audience_sizes,private.audience_universe,private.audience_members",
    );
    await pairMembers(100, 50, 10);
    await refresh();
    await as(U1);
    expect((await result()).others[0]).toMatchObject({
      below_threshold: false,
      shared: 10,
    });
    expect(
      (await result()).others.some((x) => x.platform === "instagram"),
    ).toBe(false);
  });

  it("records a computed zero for a channel with no eligible members", async () => {
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    await pairMembers(100, 20, 10);
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id,title) values($1,$2,$2,'UC_empty','Empty audience')",
      [D, W1],
    );
    await refresh();
    await as(U1);
    const empty = (await result()).others.find(
      (other) => other.channel_id === D,
    );
    expect(empty).toMatchObject({
      audience_size: 0,
      below_threshold: true,
      shared: null,
      share_of_mine: null,
    });
  });

  it("removes stale pairs, upserts daily history and expires history older than 30 days", async () => {
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    await pairMembers(100, 50, 10);
    await db.query(
      "insert into private.audience_overlap_history values($1,$2,$3,current_date-31,100,50,10)",
      [W1, A, B],
    );
    await refresh();
    expect(
      await n(
        "select count(*) n from private.audience_overlap_history where workspace_id=$1 and day=current_date",
        [W1],
      ),
    ).toBe(1);
    await db.query(
      "delete from private.audience_members where workspace_id=$1 and channel_id=$2 and member_hash=(select min(member_hash) from private.audience_members where workspace_id=$1 and channel_id=$2)",
      [W1, B],
    );
    await refresh();
    expect(
      await n(
        "select count(*) n from private.audience_overlap_history where workspace_id=$1 and day=current_date",
        [W1],
      ),
    ).toBe(1);
    expect(
      await n(
        "select shared n from private.audience_overlap_history where workspace_id=$1 and channel_a=$2 and channel_b=$3 and day=current_date",
        [W1, A, B],
      ),
    ).toBe(9);
    await db.query(
      "delete from private.audience_members where workspace_id=$1 and channel_id=$2",
      [W1, B],
    );
    await refresh();
    expect(
      await n(
        "select count(*) n from private.audience_overlap_cells where workspace_id=$1",
        [W1],
      ),
    ).toBe(0);
    expect(
      await n(
        "select count(*) n from private.audience_overlap_history where workspace_id=$1 and day<current_date-30",
        [W1],
      ),
    ).toBe(0);
  });

  it("leaves all data untouched with the switch off and backfills only the chosen plans without auditing", async () => {
    await pairMembers(100, 20, 10);
    expect(await refresh()).toBe(0);
    expect(await n("select count(*) n from private.audience_sizes")).toBe(0);
    expect(
      await n(
        "select count(*) n from public.audit_events where action='plan_updated'",
      ),
    ).toBe(0);
    expect(
      (
        await db.query<{ key: string; audience_overlap: boolean }>(
          "select key,audience_overlap from plans order by key",
        )
      ).rows
        .filter((r) => r.audience_overlap)
        .map((r) => r.key)
        .sort(),
    ).toEqual(["agency", "enterprise", "media", "owner"]);
    await db.query(
      "update plans set audience_overlap=false where key='agency'",
    );
    expect(
      await n(
        "select count(*) n from public.audit_events where action='plan_updated' and target_id='agency'",
      ),
    ).toBe(1);
  });
});
