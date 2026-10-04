import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = "20261005010000_counts_from_video_comment_stats.sql";

const ADMIN = "10000000-0000-4000-8000-000000000001";
const OWNER_A = "10000000-0000-4000-8000-000000000002";
const OWNER_B = "10000000-0000-4000-8000-000000000003";
const OWNER_S = "10000000-0000-4000-8000-000000000004";
const W_A = "20000000-0000-4000-8000-000000000001";
const W_B = "20000000-0000-4000-8000-000000000002";
const W_S = "20000000-0000-4000-8000-000000000003";
const C_A = "30000000-0000-4000-8000-000000000001";
const C_B = "30000000-0000-4000-8000-000000000002";
const C_S = "30000000-0000-4000-8000-000000000003";
const A_ONE = "40000000-0000-4000-8000-000000000001";
const A_EMPTY = "40000000-0000-4000-8000-000000000002";
const B_ONE = "40000000-0000-4000-8000-000000000003";
const S_EXISTING = "40000000-0000-4000-8000-000000000004";
const S_PARTIAL = "40000000-0000-4000-8000-000000000005";
const S_UNKNOWN = "40000000-0000-4000-8000-000000000006";

type SelectionCounts = {
  estimate: number;
  unknown_count: number;
  outstanding: number;
  remaining_after: number;
};

type AdminCount = {
  id: string;
  workspace_id: string;
  video_count: number;
  comment_count: number;
};

let db: PGlite;
let oldSelection: SelectionCounts;
let oldQuotaCode: string | undefined;

async function bootstrap(database: PGlite) {
  await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
    create function public.__pgrst_probe() returns int language sql as 'select 42';
    create function public.__pgrst_probe2(text) returns int language sql as 'select 42';
    create function public.__pgrst_probe2(text, text[]) returns int language sql as 'select 42';`);
}

async function applyEarlierMigrations(database: PGlite) {
  for (const filename of readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql") && name !== migration)
    .sort()) {
    await database.exec(
      readFileSync(`supabase/migrations/${filename}`, "utf8"),
    );
  }
}

async function as(user: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}

async function seedWorkspace(
  workspace: string,
  owner: string,
  channel: string,
  suffix: string,
) {
  await db.query("insert into auth.users(id,email) values ($1,$2)", [
    owner,
    `${suffix}@example.test`,
  ]);
  await db.query(
    "insert into workspaces(id,name,created_by) values ($1,$2,$3)",
    [workspace, `workspace-${suffix}`, owner],
  );
  await db.query(
    "insert into memberships(workspace_id,user_id,role) values ($1,$2,'workspace_owner')",
    [workspace, owner],
  );
  await db.query(
    "insert into clients(id,workspace_id,name) values ($1,$1,$2)",
    [workspace, `client-${suffix}`],
  );
  await db.query(
    `insert into channels(
       id,workspace_id,client_id,platform,external_channel_id,title,status
     ) values ($1,$2,$2,'youtube',$3,$4,'connected')`,
    [
      channel,
      workspace,
      `UC${suffix.repeat(22).slice(0, 22)}`,
      `channel-${suffix}`,
    ],
  );
}

async function insertVideo(
  workspace: string,
  channel: string,
  video: string,
  external: string,
  reported: number | null = null,
) {
  await db.query(
    `insert into videos(
       id,workspace_id,channel_id,platform,external_video_id,title,
       reported_comment_count,comments_state
     ) values ($1,$2,$3,'youtube',$4,$4,$5,'open')`,
    [video, workspace, channel, external, reported],
  );
}

async function insertComments(
  workspace: string,
  video: string,
  prefix: string,
  count: number,
) {
  for (let index = 0; index < count; index += 1) {
    await db.query(
      `insert into comments(
         id,workspace_id,video_id,platform,external_comment_id,text_raw,
         text_plain,content_hash,timestamp_precision,source
       ) values (gen_random_uuid(),$1,$2,'youtube',$3,$3,$3,$3,'second','test')`,
      [workspace, video, `${prefix}-${index}`],
    );
  }
}

async function callSelection(): Promise<SelectionCounts> {
  await db.exec("begin");
  try {
    await as(OWNER_S);
    const result = await db.query<{ result: SelectionCounts }>(
      "select select_videos($1,$2,$3::uuid[],'{}'::uuid[]) as result",
      [W_S, C_S, [S_PARTIAL, S_UNKNOWN]],
    );
    await db.exec("rollback");
    return {
      estimate: result.rows[0].result.estimate,
      unknown_count: result.rows[0].result.unknown_count,
      outstanding: result.rows[0].result.outstanding,
      remaining_after: result.rows[0].result.remaining_after,
    };
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function callOverQuota(): Promise<string | undefined> {
  await db.exec("begin; reset role");
  try {
    await db.query("update plans set analysis_units=49 where key='pilot'");
    await as(OWNER_S);
    await db.query("select select_videos($1,$2,$3::uuid[],'{}'::uuid[])", [
      W_S,
      C_S,
      [S_PARTIAL, S_UNKNOWN],
    ]);
    await db.exec("rollback");
    return undefined;
  } catch (error) {
    await db.exec("rollback");
    return (error as { code?: string }).code;
  }
}

describe("precomputed comment counts", () => {
  beforeAll(async () => {
    db = new PGlite();
    await bootstrap(db);
    await applyEarlierMigrations(db);
    await db.exec("reset role");

    await db.query("insert into auth.users(id,email) values ($1,$2)", [
      ADMIN,
      "admin@example.test",
    ]);
    await db.query("insert into private.platform_admins(user_id) values ($1)", [
      ADMIN,
    ]);
    await seedWorkspace(W_A, OWNER_A, C_A, "a");
    await seedWorkspace(W_B, OWNER_B, C_B, "b");
    await seedWorkspace(W_S, OWNER_S, C_S, "s");

    await insertVideo(W_A, C_A, A_ONE, "video-a-one");
    await insertVideo(W_A, C_A, A_EMPTY, "video-a-empty");
    await insertVideo(W_B, C_B, B_ONE, "video-b-one");
    await insertComments(W_A, A_ONE, "a", 2);
    await insertComments(W_B, B_ONE, "b", 3);

    await insertVideo(W_S, C_S, S_EXISTING, "video-s-existing", 40);
    await insertVideo(W_S, C_S, S_PARTIAL, "video-s-partial", 25);
    await insertVideo(W_S, C_S, S_UNKNOWN, "video-s-unknown", null);
    await insertComments(W_S, S_EXISTING, "existing", 10);
    await insertComments(W_S, S_PARTIAL, "partial", 5);
    await insertComments(W_S, S_UNKNOWN, "unknown", 2);
    await db.query(
      `insert into video_selections(workspace_id,channel_id,video_id,selected_by)
       values ($1,$2,$3,$4)`,
      [W_S, C_S, S_EXISTING, OWNER_S],
    );
    await db.query(
      `insert into subscriptions(
         workspace_id,plan_key,status,period_start,period_end
       ) values ($1,'pilot','active',now()-interval '1 day',now()+interval '29 days')`,
      [W_S],
    );

    oldSelection = await callSelection();
    oldQuotaCode = await callOverQuota();
    await db.exec("reset role");
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  });

  afterAll(async () => {
    await db?.close();
  });

  it("keeps admin channel counts exact and tenant-scoped without scanning comments", async () => {
    await as(ADMIN);
    const actual = (
      await db.query<{ row: AdminCount }>("select admin_channels() as row")
    ).rows.map(({ row }) => row);

    await db.exec("reset role");
    const expected = (
      await db.query<AdminCount>(
        `select c.id::text, c.workspace_id::text,
           count(distinct v.id)::int as video_count,
           count(cm.id)::int as comment_count
         from channels c
         left join videos v
           on v.workspace_id=c.workspace_id and v.channel_id=c.id
         left join comments cm
           on cm.workspace_id=v.workspace_id and cm.video_id=v.id
         group by c.id, c.workspace_id
         order by c.id`,
      )
    ).rows;
    const normalized = actual
      .map((row) => ({
        id: row.id,
        workspace_id: row.workspace_id,
        video_count: row.video_count,
        comment_count: row.comment_count,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(normalized).toEqual(expected);

    await as(OWNER_A);
    await expect(db.query("select admin_channels()")).rejects.toMatchObject({
      code: "42501",
    });

    await db.exec("reset role");
    const definition = (
      await db.query<{ definition: string }>(
        "select pg_get_functiondef('public.admin_channels()'::regprocedure) as definition",
      )
    ).rows[0].definition.toLowerCase();
    expect(definition).toContain("private.video_comment_stats");
    expect(definition).toMatch(/s\.workspace_id\s*=\s*v\.workspace_id/);
    expect(definition).toMatch(/v\.workspace_id\s*=\s*c\.workspace_id/);
    expect(definition).not.toContain("public.comments");
    expect(definition).not.toContain("public.sentiment_predictions");
  });

  it("preserves selection arithmetic and quota refusal without scanning comments", async () => {
    const currentSelection = await callSelection();
    expect(currentSelection).toEqual(oldSelection);
    expect(currentSelection).toEqual({
      estimate: 20,
      unknown_count: 1,
      outstanding: 30,
      remaining_after: 24950,
    });

    expect(oldQuotaCode).toBe("53400");
    await expect(callOverQuota()).resolves.toBe("53400");

    await db.exec("reset role");
    const definition = (
      await db.query<{ definition: string }>(
        `select pg_get_functiondef(
           'private.select_videos_impl(uuid,uuid,uuid[],uuid[])'::regprocedure
         ) as definition`,
      )
    ).rows[0].definition.toLowerCase();
    expect(definition).toContain("private.video_comment_stats");
    expect(definition).not.toContain("public.comments");
    expect(definition).not.toContain("public.sentiment_predictions");
  });
});
