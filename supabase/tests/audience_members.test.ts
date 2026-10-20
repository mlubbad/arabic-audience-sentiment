import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const W1 = "00000000-0000-4000-8000-0000000000a1";
const W2 = "00000000-0000-4000-8000-0000000000b1";
const U1 = "10000000-0000-4000-8000-0000000000a1";
const U2 = "10000000-0000-4000-8000-0000000000b1";
const C1 = "20000000-0000-4000-8000-0000000000a1";
const C2 = "20000000-0000-4000-8000-0000000000a2";
const C3 = "20000000-0000-4000-8000-0000000000b1";
const V1 = "30000000-0000-4000-8000-0000000000a1";
const V2 = "30000000-0000-4000-8000-0000000000a2";
const V3 = "30000000-0000-4000-8000-0000000000b1";
const PERSON = "UC_same_person";
let db: PGlite;

async function comment(video: string, author: string | null, age = 0) {
  await db.query(
    `insert into comments(workspace_id,video_id,external_comment_id,author_channel_id,text_raw,text_plain,content_hash,timestamp_precision,source,first_seen_at,last_seen_at)
     values ((select workspace_id from videos where id=$1),$1,gen_random_uuid()::text,$2,'text','text','hash','second','youtube_data_api',now()-$3::interval,now()-$3::interval)`,
    [video, author, `${age} days`],
  );
}
const n = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: string }>(sql, params)).rows[0].n);
const drain = async (max = 20000) =>
  Number(
    (
      await db.query<{ n: number }>(
        "select private.drain_audience_members($1) n",
        [max],
      )
    ).rows[0].n,
  );

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create schema extensions; create extension pgcrypto with schema extensions;
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
    create schema vault;
    create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,secret text);
    create view vault.decrypted_secrets as select name,secret decrypted_secret from vault.secrets;
    create function vault.create_secret(text,text,text) returns uuid language plpgsql as $$declare i uuid; begin insert into vault.secrets(secret,name) values($1,$2) returning id into i; return i; end$$;
    create function vault.update_secret(uuid,text,text,text) returns uuid language plpgsql as $$begin update vault.secrets set secret=$2,name=$3 where id=$1; return $1; end$$;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [U1, U2]);
  for (const [w, u, name] of [
    [W1, U1, "A"],
    [W2, U2, "B"],
  ]) {
    await db.query(
      "insert into workspaces(id,name,created_by) values($1,$3,$2)",
      [w, u, name],
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
  for (const [c, w, ext] of [
    [C1, W1, "UC_owner_a"],
    [C2, W1, "UC_owner_b"],
    [C3, W2, "UC_owner_c"],
  ])
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id) values($1,$2,$2,$3)",
      [c, w, ext],
    );
  for (const [v, w, c] of [
    [V1, W1, C1],
    [V2, W1, C2],
    [V3, W2, C3],
  ])
    await db.query(
      "insert into videos(id,workspace_id,channel_id,external_video_id,title) values($1,$2,$3,$4,'video')",
      [v, w, c, v],
    );
});
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec(
    "truncate private.audience_member_videos, private.audience_members",
  );
  await db.query(
    "update private.audience_drain_state set last_seen_at=null,last_id=null where singleton",
  );
  await db.query(
    "update private.platform_switches set enabled=false where key='audience_overlap'",
  );
  await db.query("delete from comments");
  await db.query("delete from vault.secrets where name='audience_pepper'");
  await db.query(
    "select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'audience_pepper','test')",
  );
});

describe("hashed audience identities", () => {
  it("keeps the switch off inert, then hashes across channels and tenants", async () => {
    await comment(V1, PERSON);
    await comment(V1, PERSON);
    await comment(V2, PERSON);
    await comment(V3, PERSON);
    expect(await drain()).toBe(0);
    expect(await n("select count(*) n from private.audience_members")).toBe(0);
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    expect(await drain()).toBe(3);
    expect(await n("select count(*) n from private.audience_members")).toBe(3);
    expect(
      await n(
        "select count(*) n from private.audience_members where workspace_id=$1 and member_hash=(select member_hash from private.audience_members where channel_id=$2)",
        [W1, C1],
      ),
    ).toBe(2);
    expect(
      await n("select count(*) n from private.audience_member_videos"),
    ).toBe(3);
    expect(
      await n(
        "select comment_count n from private.audience_member_videos where video_id=$1",
        [V1],
      ),
    ).toBe(2);
    expect(
      await n(
        "select comment_count n from private.audience_member_videos where video_id=$1",
        [V2],
      ),
    ).toBe(1);
    const hashes = (
      await db.query<{ hash: string; bytes: number }>(
        "select encode(member_hash,'hex') hash,octet_length(member_hash) bytes from private.audience_members where workspace_id=$1 order by channel_id",
        [W1],
      )
    ).rows;
    expect(hashes[0].hash).toBe(hashes[1].hash);
    expect(hashes[0].bytes).toBe(32);
    expect(
      (
        await db.query<{ raw: boolean }>(
          "select member_hash <> convert_to($1,'utf8') raw from private.audience_members where workspace_id=$2 limit 1",
          [PERSON, W1],
        )
      ).rows[0].raw,
    ).toBe(true);
    await db.query("delete from vault.secrets where name='audience_pepper'");
    await db.query(
      "update comments set last_seen_at=now()+interval '1 second' where author_channel_id=$1",
      [PERSON],
    );
    expect(await drain()).toBe(0);
    expect(await n("select count(*) n from private.audience_members")).toBe(3);
    await db.query(
      "select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'audience_pepper','test')",
    );
  });

  it("excludes null, purged, and owner identities and recomputes rather than incrementing", async () => {
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    await comment(V1, PERSON);
    await comment(V1, null);
    await comment(V1, "UC_owner_a");
    await comment(V1, "UC_purged");
    await db.query(
      "update comments set content_purged_at=now(),author_channel_id=null where author_channel_id='UC_purged'",
    );
    expect(await drain()).toBe(1);
    expect(
      await n(
        "select count(*) n from private.audience_member_videos where video_id=$1",
        [V1],
      ),
    ).toBe(1);
    await db.query(
      "update comments set last_seen_at=now()+interval '1 second' where author_channel_id=$1",
      [PERSON],
    );
    expect(await drain()).toBe(1);
    expect(
      await n(
        "select comment_count n from private.audience_member_videos where video_id=$1",
        [V1],
      ),
    ).toBe(1);
  });

  it("enforces private access, bounded batches and admin rotation", async () => {
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    await comment(V1, PERSON);
    await comment(V2, PERSON);
    expect(await drain(1)).toBe(1);
    expect(await drain()).toBe(1);
    await db.exec("set role authenticated");
    await expect(
      db.query("select * from private.audience_members"),
    ).rejects.toThrow();
    await expect(
      db.query("select private.audience_pepper()"),
    ).rejects.toThrow();
    await db.exec("reset role");
    await db.exec("set role anon");
    await expect(
      db.query("select * from private.audience_member_videos"),
    ).rejects.toThrow();
    await db.exec("reset role");
    await expect(
      db.query("select public.admin_rotate_audience_pepper()"),
    ).rejects.toThrow(/forbidden/);
    await db.query("insert into private.platform_admins(user_id) values($1)", [
      U1,
    ]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [U1]);
    const oldHash = (
      await db.query<{ h: string }>(
        "select encode(member_hash,'hex') h from private.audience_members where channel_id=$1",
        [C1],
      )
    ).rows[0].h;
    await db.query("select public.admin_rotate_audience_pepper()");
    expect(await n("select count(*) n from private.audience_members")).toBe(0);
    expect(
      await n(
        "select count(*) n from public.audit_events where action='audience_pepper_rotated'",
      ),
    ).toBe(1);
    await drain();
    expect(await n("select count(*) n from private.audience_members")).toBe(2);
    const newHash = (
      await db.query<{ h: string }>(
        "select encode(member_hash,'hex') h from private.audience_members where channel_id=$1",
        [C1],
      )
    ).rows[0].h;
    expect(newHash).not.toBe(oldHash);
  });

  it("purges stale identity rows in the same retention window and preserves recent rows", async () => {
    await db.query(
      "update private.platform_switches set enabled=true where key='audience_overlap'",
    );
    await comment(V1, "UC_old", 31);
    await comment(V1, "UC_recent", 29);
    await drain();
    expect(
      (await db.query<{ n: number }>("select private.purge_comment_text() n"))
        .rows[0].n,
    ).toBe(1);
    expect(
      await n(
        "select count(*) n from private.audience_members where channel_id=$1",
        [C1],
      ),
    ).toBe(1);
    expect(
      await n(
        "select count(*) n from private.audience_member_videos where video_id=$1",
        [V1],
      ),
    ).toBe(1);
    expect(
      await n(
        "select count(*) n from comments where content_purged_at is not null",
      ),
    ).toBe(1);
  });
});
