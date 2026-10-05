import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const OWNER_A = "10000000-0000-4000-8000-000000000001";
const OWNER_B = "10000000-0000-4000-8000-000000000002";
const VIDEO_A = "20000000-0000-4000-8000-000000000001";
const VIDEO_B = "20000000-0000-4000-8000-000000000002";
const SORTS = [
  "published_desc",
  "published_asc",
  "likes_desc",
  "likes_asc",
] as const;

type Page = {
  total: number | null;
  comments: Array<{ id: string }>;
  has_more: boolean;
  next_cursor: string | null;
};

let db: PGlite;

async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}

async function page(workspace: string, filters: Record<string, unknown>) {
  const result = await db.query<{ value: Page }>(
    "select private.dashboard_comments_impl($1, $2::jsonb) as value",
    [workspace, JSON.stringify(filters)],
  );
  return result.rows[0].value;
}

async function offsetWalk(sort: (typeof SORTS)[number]) {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 3) {
    const current = await page(A, { sort, limit: 3, offset });
    ids.push(...current.comments.map(({ id }) => id));
    if (!current.has_more) return ids;
  }
}

async function keysetWalk(sort: (typeof SORTS)[number]) {
  const ids: string[] = [];
  let after: string | undefined;
  for (;;) {
    const current = await page(A, { sort, limit: 3, after });
    ids.push(...current.comments.map(({ id }) => id));
    if (!current.has_more) return ids;
    expect(current.next_cursor).toEqual(expect.any(String));
    after = current.next_cursor!;
  }
}

describe("dashboard comments keyset paging", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;`);
    for (const file of readdirSync("supabase/migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    }

    await db.query("insert into auth.users(id) values ($1),($2)", [
      OWNER_A,
      OWNER_B,
    ]);
    for (const [workspace, owner, video] of [
      [A, OWNER_A, VIDEO_A],
      [B, OWNER_B, VIDEO_B],
    ]) {
      await db.query(
        "insert into public.workspaces(id,name,created_by) values ($1,'w',$2)",
        [workspace, owner],
      );
      await db.query(
        "insert into public.memberships values ($1,$2,'workspace_owner')",
        [workspace, owner],
      );
      await db.query(
        "insert into public.clients(id,workspace_id,name) values ($1,$1,'c')",
        [workspace],
      );
      await db.query(
        `insert into public.channels(id,workspace_id,client_id,external_channel_id,status)
         values ($1,$1,$1,$2,'connected')`,
        [workspace, `UC${workspace.slice(-22)}`],
      );
      await db.query(
        `insert into public.videos(id,workspace_id,channel_id,external_video_id,title)
         values ($1,$2,$2,$3,'video')`,
        [video, workspace, `video-${workspace}`],
      );
    }

    const rows = [
      [1, "2026-10-10T10:00:00Z", 10],
      [2, "2026-10-10T10:00:00Z", 10],
      [3, "2026-10-09T10:00:00Z", 10],
      [4, "2026-10-08T10:00:00Z", 5],
      [5, "2026-10-08T10:00:00Z", 5],
      [6, "2026-10-07T10:00:00Z", null],
      [7, null, 5],
      [8, null, null],
      [9, null, null],
      [10, null, null],
    ] as const;
    for (const [suffix, publishedAt, likes] of rows) {
      const id = `30000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
      await db.query(
        `insert into public.comments(id,workspace_id,video_id,external_comment_id,
           text_raw,text_plain,content_hash,timestamp_precision,source,published_at,likes_value)
         values ($1,$2,$3,$4,$4,$4,$4,'second','youtube_data_api_public',$5,$6)`,
        [id, A, VIDEO_A, `a-${suffix}`, publishedAt, likes],
      );
    }
    for (let suffix = 1; suffix <= 4; suffix += 1) {
      await db.query(
        `insert into public.comments(id,workspace_id,video_id,external_comment_id,
           text_raw,text_plain,content_hash,timestamp_precision,source,published_at,likes_value)
         values ($1,$2,$3,$4,$4,$4,$4,'second','youtube_data_api_public',$5,$6)`,
        [
          `40000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`,
          B,
          VIDEO_B,
          `b-${suffix}`,
          `2026-10-0${suffix}T10:00:00Z`,
          suffix,
        ],
      );
    }
    await asUser(OWNER_A);
  });

  afterAll(async () => {
    await db?.close();
  });

  it.each(SORTS)(
    "matches OFFSET order for %s, including ties and nulls",
    async (sort) => {
      expect(await keysetWalk(sort)).toEqual(await offsetWalk(sort));
    },
  );

  it("does not duplicate or skip original rows when a newer row arrives", async () => {
    const expected = await offsetWalk("published_desc");
    const first = await page(A, { sort: "published_desc", limit: 3 });

    await db.exec("reset role");
    await db.query(
      `insert into public.comments(id,workspace_id,video_id,external_comment_id,
         text_raw,text_plain,content_hash,timestamp_precision,source,published_at,likes_value)
       values ('30000000-0000-4000-8000-999999999999',$1,$2,'newer','newer','newer',
         'newer','second','youtube_data_api_public','2026-10-11T10:00:00Z',99)`,
      [A, VIDEO_A],
    );
    await asUser(OWNER_A);

    const walked = first.comments.map(({ id }) => id);
    let after = first.next_cursor;
    while (after) {
      const current = await page(A, {
        sort: "published_desc",
        limit: 3,
        after,
      });
      walked.push(...current.comments.map(({ id }) => id));
      after = current.next_cursor;
    }
    expect(walked).toEqual(expected);
    expect(new Set(walked).size).toBe(expected.length);
  });

  it("rejects malformed, wrong-sort, and other-workspace cursors", async () => {
    const valid = await page(A, { sort: "published_desc", limit: 3 });
    await expect(
      page(A, { sort: "published_desc", limit: 3, after: "not-hex" }),
    ).rejects.toMatchObject({ code: "22023", message: "invalid_cursor" });
    await expect(
      page(A, { sort: "published_asc", limit: 3, after: valid.next_cursor }),
    ).rejects.toMatchObject({ code: "22023", message: "invalid_cursor" });

    await asUser(OWNER_B);
    const other = await page(B, { sort: "published_desc", limit: 2 });
    await asUser(OWNER_A);
    await expect(
      page(A, { sort: "published_desc", limit: 3, after: other.next_cursor }),
    ).rejects.toMatchObject({ code: "22023", message: "invalid_cursor" });
  });

  it("skips the total count on request without changing rows or isolation", async () => {
    const counted = await page(A, { sort: "likes_desc", limit: 3 });
    const uncounted = await page(A, {
      sort: "likes_desc",
      limit: 3,
      with_total: "false",
    });
    expect(uncounted.total).toBeNull();
    expect(uncounted.comments).toEqual(counted.comments);
    expect(
      uncounted.comments.every(({ id }) => !id.startsWith("40000000")),
    ).toBe(true);
  });
});
