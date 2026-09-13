import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const ownerA = "10000000-0000-4000-8000-000000000001";
const ownerB = "10000000-0000-4000-8000-000000000002";
const analyst = "10000000-0000-4000-8000-000000000003";
const viewer = "10000000-0000-4000-8000-000000000004";
let db: PGlite;

async function user(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
const admin = () => db.exec("reset role");
const count = async (sql: string, p: unknown[] = []) =>
  (await db.query<{ n: number }>(sql, p)).rows[0].n;

describe("collection catalogue tables", () => {
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
    await db.query("insert into auth.users(id) values ($1),($2),($3),($4)", [
      ownerA,
      ownerB,
      analyst,
      viewer,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'A',$3),($2,'B',$4)",
      [A, B, ownerA, ownerB],
    );
    await db.query(
      "insert into memberships values ($1,$2,'workspace_owner'),($3,$4,'workspace_owner'),($1,$5,'analyst'),($1,$6,'viewer')",
      [A, ownerA, B, ownerB, analyst, viewer],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'A'),($2,$2,'B')",
      [A, B],
    );
    await db.query(
      "insert into channels(id,workspace_id,client_id,external_channel_id) values ($1,$1,$1,'UC_A'),($2,$2,$2,'UC_B')",
      [A, B],
    );
    await db.query(
      "insert into videos(id,workspace_id,channel_id,external_video_id,title) values ($1,$1,$1,'v','t'),($2,$2,$2,'v','t')",
      [A, B],
    );
    await db.query(
      `insert into comments(id,workspace_id,video_id,external_comment_id,text_raw,text_plain,content_hash,timestamp_precision,source)
       values ($1,$1,$1,'c','n','n','h','second','x'),($2,$2,$2,'c','n','n','h','second','x')`,
      [A, B],
    );
  });
  afterAll(async () => {
    await db?.close();
  });

  it("G1: records a sync run, and a stoppage is never a success", async () => {
    await admin();
    await db.query(
      `insert into sync_runs(workspace_id,channel_id,mode,source,status,ended_at,error_code,coverage_summary)
       values ($1,$1,'collect','youtube_data_api_public','partial',now(),'source_ended_without_completion',
               '{"videos_seen":3,"comments_collected":120,"complete":false}')`,
      [A],
    );
    // The vocabulary is the one the jobs table already uses; an invented status
    // cannot be smuggled in to make a stoppage look finished.
    await expect(
      db.query(
        "insert into sync_runs(workspace_id,channel_id,mode,source,status) values ($1,$1,'collect','x','complete')",
        [A],
      ),
    ).rejects.toThrow();
    // A run cannot be attributed to another workspace's channel.
    await expect(
      db.query(
        "insert into sync_runs(workspace_id,channel_id,mode,source,status) values ($1,$2,'collect','x','running')",
        [A, B],
      ),
    ).rejects.toThrow();

    await user(ownerA);
    expect(await count("select count(*)::int as n from sync_runs")).toBe(1);
    await expect(
      db.query(
        "insert into sync_runs(workspace_id,channel_id,mode,source,status) values ($1,$1,'collect','x','running')",
        [A],
      ),
    ).rejects.toThrow();
    await user(ownerB);
    expect(await count("select count(*)::int as n from sync_runs")).toBe(0);
  });

  it("G1: carries every field the dashboard projection reads", async () => {
    await user(ownerA);
    const run = await db.query<Record<string, unknown>>(
      "select started_at, ended_at, status, source, error_code, coverage_summary from sync_runs limit 1",
    );
    expect(Object.keys(run.rows[0]).sort()).toEqual([
      "coverage_summary",
      "ended_at",
      "error_code",
      "source",
      "started_at",
      "status",
    ]);
    expect(run.rows[0].coverage_summary).toEqual({
      videos_seen: 3,
      comments_collected: 120,
      complete: false,
    });
  });

  it("G2: refuses the same file twice and a path outside the workspace", async () => {
    await admin();
    await db.query(
      "insert into imports(workspace_id,file_path,file_hash,schema_version,status) values ($1::uuid,$1::text||'/legacy.csv','deadbeef','v1','pending')",
      [A],
    );
    // Re-uploading the same file returns the earlier result rather than
    // importing twice, so the hash must be unique per workspace.
    await expect(
      db.query(
        "insert into imports(workspace_id,file_path,file_hash,schema_version,status) values ($1::uuid,$1::text||'/again.csv','deadbeef','v1','pending')",
        [A],
      ),
    ).rejects.toThrow();
    // The private bucket policy scopes by the leading path segment, so a path
    // that does not start with the workspace would be unreachable or worse.
    await expect(
      db.query(
        "insert into imports(workspace_id,file_path,file_hash,schema_version,status) values ($1::uuid,$2::text||'/theirs.csv','beefdead','v1','pending')",
        [A, B],
      ),
    ).rejects.toThrow();
    // A different workspace may legitimately import the identical file.
    await expect(
      db.query(
        "insert into imports(workspace_id,file_path,file_hash,schema_version,status) values ($1::uuid,$1::text||'/legacy.csv','deadbeef','v1','pending')",
        [B],
      ),
    ).resolves.toBeTruthy();
  });

  it("G3: the audit log is owner-only and cannot be rewritten", async () => {
    await admin();
    await db.query(
      "insert into audit_events(workspace_id,actor_id,action,target_type,target_id) values ($1::uuid,$2::uuid,'channel.connected','channel',$1::text)",
      [A, ownerA],
    );
    await user(ownerA);
    expect(await count("select count(*)::int as n from audit_events")).toBe(1);
    // An analyst and a viewer have no business reading who did what.
    await user(analyst);
    expect(await count("select count(*)::int as n from audit_events")).toBe(0);
    await user(viewer);
    expect(await count("select count(*)::int as n from audit_events")).toBe(0);
    // Immutable even for a role that bypasses row-level security.
    await admin();
    await expect(
      db.query("update audit_events set action='x'"),
    ).rejects.toThrow(/append_only/);
    await expect(db.query("delete from audit_events")).rejects.toThrow(
      /append_only/,
    );
    // Bounded fields, so a comment body cannot be parked in the audit trail.
    await expect(
      db.query(
        "insert into audit_events(workspace_id,actor_id,action,target_type,target_id) values ($1::uuid,$2::uuid,$3,'channel',$1::text)",
        [A, ownerA, "x".repeat(200)],
      ),
    ).rejects.toThrow();
  });

  it("G4: annotations carry provenance and stay with their own comment", async () => {
    await admin();
    await db.query(
      "insert into comment_annotations(workspace_id,comment_id,kind,value,method,version) values ($1,$1,'comment_type','سؤال','rules','v1')",
      [A],
    );
    // Where a label came from is never assumed.
    await expect(
      db.query(
        "insert into comment_annotations(workspace_id,comment_id,kind,value,method,version) values ($1,$1,'comment_type','x','vibes','v1')",
        [A],
      ),
    ).rejects.toThrow();
    // Same comment, same kind, same version cannot be written twice.
    await expect(
      db.query(
        "insert into comment_annotations(workspace_id,comment_id,kind,value,method,version) values ($1,$1,'comment_type','y','model','v1')",
        [A],
      ),
    ).rejects.toThrow();
    // A newer version is a different row, so history is kept.
    await expect(
      db.query(
        "insert into comment_annotations(workspace_id,comment_id,kind,value,method,version) values ($1,$1,'comment_type','y','model','v2')",
        [A],
      ),
    ).resolves.toBeTruthy();
    // And an annotation cannot be hung on another workspace's comment.
    await expect(
      db.query(
        "insert into comment_annotations(workspace_id,comment_id,kind,value,method,version) values ($1,$2,'comment_type','x','rules','v1')",
        [A, B],
      ),
    ).rejects.toThrow();

    await user(ownerB);
    expect(
      await count("select count(*)::int as n from comment_annotations"),
    ).toBe(0);
    await user(ownerA);
    expect(
      await count("select count(*)::int as n from comment_annotations"),
    ).toBe(2);
    // Annotations are not sentiment: writing one is a server operation.
    await expect(
      db.query(
        "insert into comment_annotations(workspace_id,comment_id,kind,value,method,version) values ($1,$1,'k','v','manual','v9')",
        [A],
      ),
    ).rejects.toThrow();
  });
});
