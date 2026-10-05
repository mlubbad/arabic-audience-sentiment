import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const OWNER_A = "10000000-0000-4000-8000-0000000000a1";
const OWNER_B = "10000000-0000-4000-8000-0000000000b1";
const CHANNEL_OWNER_ID = "UC_AAAAAAAAAAAAAAAAAAAAAA";

type Kpis = {
  replies: number;
  unknown_dates: number;
  unique_authors: number;
};

let db: PGlite;
let videoA1: string;
let videoA2: string;

async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}

async function aggregate(filters: Record<string, string>): Promise<Kpis> {
  const result = await db.query<{ aggregate: Kpis }>(
    "select private.dashboard_aggregates_impl($1, $2::jsonb) as aggregate",
    [A, JSON.stringify(filters)],
  );
  const { replies, unknown_dates, unique_authors } = result.rows[0].aggregate;
  return { replies, unknown_dates, unique_authors };
}

async function bruteForce(filters: Record<string, string>): Promise<Kpis> {
  const clauses = [
    "cm.workspace_id = $1",
    "cm.author_channel_id is distinct from ch.external_channel_id",
  ];
  const params: unknown[] = [A];
  if (filters.video) {
    params.push(filters.video);
    clauses.push(`cm.video_id = $${params.length}::uuid`);
  }
  if (filters.replies === "replies") clauses.push("cm.is_reply");
  if (filters.q) {
    params.push(`%${filters.q}%`);
    clauses.push(
      `(cm.text_raw ilike $${params.length} or cm.author_name ilike $${params.length})`,
    );
  }
  const result = await db.query<Kpis>(
    `select
       count(*) filter (where cm.is_reply)::int as replies,
       count(*) filter (where cm.published_at is null)::int as unknown_dates,
       -- The client counts truthy ids only, so '' is not an author.
       count(distinct nullif(cm.author_channel_id, ''))::int as unique_authors
     from public.comments cm
     join public.videos v on v.id = cm.video_id
     join public.channels ch on ch.id = v.channel_id
     where ${clauses.join(" and ")}`,
    params,
  );
  return result.rows[0];
}

describe("WO-14 dashboard aggregate KPIs", () => {
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

    await db.query("insert into auth.users(id) values ($1), ($2)", [
      OWNER_A,
      OWNER_B,
    ]);
    await db.query(
      "insert into public.workspaces(id,name,created_by) values ($1,'A',$3),($2,'B',$4)",
      [A, B, OWNER_A, OWNER_B],
    );
    await db.query(
      "insert into public.memberships(workspace_id,user_id,role) values ($1,$3,'workspace_owner'),($2,$4,'workspace_owner')",
      [A, B, OWNER_A, OWNER_B],
    );
    await db.query(
      "insert into public.clients(id,workspace_id,name) values ($1,$1,'A'),($2,$2,'B')",
      [A, B],
    );
    const channels = await db.query<{ id: string; workspace_id: string }>(
      `insert into public.channels(workspace_id,client_id,platform,external_channel_id,title,status)
       values ($1,$1,'youtube',$3,'A','connected'),($2,$2,'youtube',$4,'B','connected')
       returning id, workspace_id`,
      [A, B, CHANNEL_OWNER_ID, "UC_BBBBBBBBBBBBBBBBBBBBBB"],
    );
    const channelA = channels.rows.find((row) => row.workspace_id === A)!.id;
    const channelB = channels.rows.find((row) => row.workspace_id === B)!.id;
    const videos = await db.query<{
      id: string;
      external_video_id: string;
    }>(
      `insert into public.videos(workspace_id,channel_id,platform,external_video_id,title)
       values ($1,$3,'youtube','a-one','A one'),($1,$3,'youtube','a-two','A two'),($2,$4,'youtube','b-one','B one')
       returning id, external_video_id`,
      [A, B, channelA, channelB],
    );
    videoA1 = videos.rows.find((row) => row.external_video_id === "a-one")!.id;
    videoA2 = videos.rows.find((row) => row.external_video_id === "a-two")!.id;
    const videoB = videos.rows.find(
      (row) => row.external_video_id === "b-one",
    )!.id;

    const insertComment = async (
      workspace: string,
      video: string,
      externalId: string,
      authorId: string | null,
      authorName: string,
      text: string,
      reply: boolean,
      publishedAt: string | null,
    ) =>
      db.query(
        `insert into public.comments(
          workspace_id,video_id,platform,external_comment_id,author_channel_id,
          author_name,text_raw,content_hash,is_reply,published_at,timestamp_precision,source
        ) values ($1,$2,'youtube',$3,$4,$5,$6,$7,$8,$9,$10,'youtube_scrape')`,
        [
          workspace,
          video,
          externalId,
          authorId,
          authorName,
          text,
          `hash-${externalId}`,
          reply,
          publishedAt,
          publishedAt ? "second" : "unknown",
        ],
      );

    await insertComment(
      A,
      videoA1,
      "a1",
      "author-1",
      "One",
      "needle reply",
      true,
      null,
    );
    await insertComment(
      A,
      videoA1,
      "a2",
      "author-1",
      "One",
      "ordinary",
      false,
      "2026-01-01T00:00:00Z",
    );
    await insertComment(
      A,
      videoA1,
      "a3",
      null,
      "Needle Author",
      "ordinary",
      false,
      "2026-01-02T00:00:00Z",
    );
    await insertComment(
      A,
      videoA2,
      "a4",
      "author-2",
      "Two",
      "ordinary",
      true,
      null,
    );
    await insertComment(
      A,
      videoA2,
      "a-empty",
      "",
      "Empty Id",
      "ordinary",
      false,
      "2026-01-03T00:00:00Z",
    );
    await insertComment(
      A,
      videoA2,
      "a-owner",
      CHANNEL_OWNER_ID,
      "Owner",
      "owner",
      true,
      null,
    );
    await insertComment(B, videoB, "b1", "author-b", "B", "needle", true, null);

    await asUser(OWNER_A);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it.each([
    { name: "no filter", filters: () => ({}) },
    { name: "video", filters: () => ({ video: videoA1 }) },
    { name: "replies only", filters: () => ({ replies: "replies" }) },
    { name: "free text", filters: () => ({ q: "needle" }) },
  ])(
    "matches brute-force client definitions with $name",
    async ({ filters: makeFilters }) => {
      const filters: Record<string, string> = makeFilters();
      expect(await aggregate(filters)).toEqual(await bruteForce(filters));
    },
  );

  it("ignores another workspace and counts repeated, null and empty author ids honestly", async () => {
    expect(await aggregate({})).toEqual({
      replies: 2,
      unknown_dates: 2,
      unique_authors: 2,
    });
    expect(videoA2).not.toBe(videoA1);
  });
});
