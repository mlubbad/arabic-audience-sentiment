import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const W = "00000000-0000-4000-8000-000000000001";
const owner = "10000000-0000-4000-8000-000000000001";

let db: PGlite;

async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}

describe("honest dashboard aggregates (WO-4c)", () => {
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
      .sort()) {
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    }

    await db.query("insert into auth.users(id) values ($1)", [owner]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'Honest WS',$2)",
      [W, owner],
    );
    await db.query("insert into memberships values ($1,$2,'workspace_owner')", [
      W,
      owner,
    ]);
    await db.query(
      "insert into subscriptions(workspace_id,plan_key,status,period_start,period_end) values ($1,'owner','active',now(),now()+'30 days'::interval)",
      [W],
    );

    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'Honest Client')",
      [W],
    );

    await asUser(owner);
    const chRes = await db.query<{ id: string }>(
      "select id from register_public_channel($1, $1, 'UC_HONEST_12345678901234', '@honest', 'Honest Channel')",
      [W],
    );
    const channelId = chRes.rows[0].id;

    await db.exec("reset role");
    const vidRes = await db.query<{ id: string }>(
      "insert into videos(workspace_id,channel_id,platform,external_video_id,title) values ($1,$2,'youtube','vid_honest','Honest Video') returning id",
      [W, channelId],
    );
    const videoId = vidRes.rows[0].id;

    // Seed comments:
    // 15 distinct authors (auth_ch_1 to auth_ch_15)
    // 4 replies (is_reply = true)
    // 3 unknown dates (published_at = NULL)
    // 1 channel owner comment (author_channel_id = 'UC_HONEST_12345678901234') which should be excluded from counts
    for (let i = 1; i <= 15; i++) {
      const isReply = i <= 4;
      const isNullDate = i <= 3;
      await db.query(
        `insert into comments(
          workspace_id, video_id, platform, external_comment_id,
          author_channel_id, author_name, text_raw, content_hash, is_reply, published_at,
          timestamp_precision, source
        ) values (
          $1, $2, 'youtube', $3,
          $4, $5, $6, $7, $8, $9,
          $10, 'youtube_scrape'
        )`,
        [
          W,
          videoId,
          `comm_${i}`,
          `auth_ch_${i}`,
          `Author ${i}`,
          `Comment text ${i}`,
          `hash_${i}`,
          isReply,
          isNullDate ? null : "2026-09-20T10:00:00Z",
          isNullDate ? "unknown" : "second",
        ],
      );
    }

    // Owner comment
    await db.query(
      `insert into comments(
        workspace_id, video_id, platform, external_comment_id,
        author_channel_id, author_name, text_raw, content_hash, is_reply, published_at,
        timestamp_precision, source
      ) values (
        $1, $2, 'youtube', 'comm_owner',
        'UC_HONEST_12345678901234', 'Owner Name', 'Owner reply', 'hash_owner', true, null,
        'unknown', 'youtube_scrape'
      )`,
      [W, videoId],
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  it("returns replies, unknown_dates, and uncapped unique_authors in dashboard_aggregates", async () => {
    await asUser(owner);

    const res = await db.query<{
      dashboard_aggregates: {
        total: number;
        replies: number;
        unknown_dates: number;
        unique_authors: number;
        people: unknown[];
      };
    }>("select dashboard_aggregates($1, '{}'::jsonb) as dashboard_aggregates", [
      W,
    ]);

    const agg = res.rows[0].dashboard_aggregates;
    expect(agg.total).toBe(15);
    // 4 non-owner replies
    expect(agg.replies).toBe(4);
    // 3 non-owner comments with null date
    expect(agg.unknown_dates).toBe(3);
    // 15 distinct authors - NOT capped by people list (which is LIMIT 10)
    expect(agg.unique_authors).toBe(15);
    expect(agg.people.length).toBe(10);
  });
});
