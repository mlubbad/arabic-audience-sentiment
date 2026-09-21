import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const ownerA = "10000000-0000-4000-8000-000000000001";
const ownerB = "10000000-0000-4000-8000-000000000002";
const CHANNEL_ID = "UCTPIL6f7yNpK8yc-H3cEtFg";

let db: PGlite;

async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec("set role authenticated");
}

describe("cross-workspace deduplication", () => {
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

    await db.query("insert into auth.users(id) values ($1),($2)", [
      ownerA,
      ownerB,
    ]);
    await db.query(
      "insert into workspaces(id,name,created_by) values ($1,'Workspace A',$3),($2,'Workspace B',$4)",
      [A, B, ownerA, ownerB],
    );
    await db.query(
      "insert into memberships values ($1,$3,'workspace_owner'),($2,$4,'workspace_owner')",
      [A, B, ownerA, ownerB],
    );
    await db.query(
      "insert into clients(id,workspace_id,name) values ($1,$1,'Client A'),($2,$2,'Client B')",
      [A, B],
    );
    await db.query(
      `insert into subscriptions(workspace_id,plan_key,status,period_start,period_end)
       values ($1,'enterprise','active',now()-interval '1 day',now()+interval '29 days'),
              ($2,'enterprise','active',now()-interval '1 day',now()+interval '29 days')`,
      [A, B],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("automatically adopts catalogue, comments, and sentiment predictions across workspaces", async () => {
    // 1. Workspace A registers channel and populates catalogue + comments + sentiment
    await asUser(ownerA);
    const regA = await db.query<{ id: string }>(
      "select (private.register_public_channel_impl($1, $2, $3, 'channel_a', 'Channel A')).id as id",
      [A, A, CHANNEL_ID],
    );
    const channelAId = regA.rows[0].id;
    expect(channelAId).toBeTruthy();

    await db.exec("reset role");
    // Insert video into Workspace A
    const vidInsertA = await db.query<{ id: string }>(
      `insert into public.videos (
        workspace_id, channel_id, platform, external_video_id, title, reported_comment_count, comments_state
      ) values ($1, $2, 'youtube', 'vid_ext_123', 'Shared Video', 10, 'open')
      returning id`,
      [A, channelAId],
    );
    const videoAId = vidInsertA.rows[0].id;

    // Insert comment into Workspace A
    const commentInsertA = await db.query<{ id: string }>(
      `insert into public.comments (
        workspace_id, video_id, platform, external_comment_id, text_raw, text_plain,
        content_hash, timestamp_precision, source, first_seen_at, last_seen_at
      ) values ($1, $2, 'youtube', 'comm_ext_999', 'تعليق رائع', 'تعليق رائع',
        'hash999', 'second', 'youtube_data_api_public', now(), now())
      returning id`,
      [A, videoAId],
    );
    const commentAId = commentInsertA.rows[0].id;

    // Insert analysis run and sentiment prediction into Workspace A
    const arInsertA = await db.query<{ id: string }>(
      `insert into public.analysis_runs (
        workspace_id, model_id, revision_sha, preprocessing_version, parameters, status
      ) values ($1, 'model_ar', 'sha_123', 'v1', '{"threshold": 0.5}'::jsonb, 'succeeded')
      returning id`,
      [A],
    );
    const arAId = arInsertA.rows[0].id;

    await db.query(
      `insert into public.sentiment_predictions (
        workspace_id, comment_id, content_hash, analysis_run_id, analysis_key,
        status, label, class_scores, predicted_at
      ) values ($1, $2, 'hash999', $3, 'key_1', 'succeeded', 'positive', '{"positive": 0.95}'::jsonb, now())`,
      [A, commentAId, arAId],
    );

    // 2. Workspace B registers the same channel
    await asUser(ownerB);
    const regB = await db.query<{ id: string }>(
      "select (private.register_public_channel_impl($1, $2, $3, 'channel_b', 'Channel B')).id as id",
      [B, B, CHANNEL_ID],
    );
    const channelBId = regB.rows[0].id;
    expect(channelBId).toBeTruthy();

    // 3. Workspace B should immediately have the video adopted in catalogue AND comments + sentiment adopted
    const bVideos = await db.query<{
      id: string;
      external_video_id: string;
      title: string;
    }>(
      "select id, external_video_id, title from public.videos where workspace_id = $1",
      [B],
    );
    expect(bVideos.rows).toHaveLength(1);
    expect(bVideos.rows[0].external_video_id).toBe("vid_ext_123");
    expect(bVideos.rows[0].title).toBe("Shared Video");
    const videoBId = bVideos.rows[0].id;

    // Check comments in Workspace B exist IMMEDIATELY upon registration, even before video selection
    const bCommentsBeforeSelection = await db.query<{
      id: string;
      external_comment_id: string;
      text_plain: string;
    }>(
      "select id, external_comment_id, text_plain from public.comments where workspace_id = $1",
      [B],
    );
    expect(bCommentsBeforeSelection.rows).toHaveLength(1);
    expect(bCommentsBeforeSelection.rows[0].external_comment_id).toBe(
      "comm_ext_999",
    );
    expect(bCommentsBeforeSelection.rows[0].text_plain).toBe("تعليق رائع");

    // Check sentiment predictions in Workspace B exist IMMEDIATELY
    const bSentimentBeforeSelection = await db.query<{
      label: string;
      status: string;
    }>(
      "select label, status from public.sentiment_predictions where workspace_id = $1",
      [B],
    );
    expect(bSentimentBeforeSelection.rows).toHaveLength(1);
    expect(bSentimentBeforeSelection.rows[0].label).toBe("positive");
    expect(bSentimentBeforeSelection.rows[0].status).toBe("succeeded");

    // Check dashboard aggregates for Workspace B works immediately
    const aggBeforeSelection = await db.query<{
      agg: {
        total: number;
        analysed: number;
        sentiments: { positive: number };
      };
    }>("select private.dashboard_aggregates_impl($1, '{}'::jsonb) as agg", [B]);
    expect(aggBeforeSelection.rows[0].agg.total).toBe(1);
    expect(aggBeforeSelection.rows[0].agg.analysed).toBe(1);
    expect(aggBeforeSelection.rows[0].agg.sentiments.positive).toBe(1);

    // 4. Workspace B selects the video -> updates selection status idempotently
    await asUser(ownerB);
    const selResult = await db.query<{ r: Record<string, unknown> }>(
      "select private.select_videos_impl($1, $2, array[$3]::uuid[], array[]::uuid[]) as r",
      [B, channelBId, videoBId],
    );
    expect(selResult.rows[0].r).toBeDefined();

    // Check comments in Workspace B still intact
    const bComments = await db.query<{
      id: string;
      external_comment_id: string;
      text_plain: string;
    }>(
      "select id, external_comment_id, text_plain from public.comments where workspace_id = $1",
      [B],
    );
    expect(bComments.rows).toHaveLength(1);
    expect(bComments.rows[0].external_comment_id).toBe("comm_ext_999");
    expect(bComments.rows[0].text_plain).toBe("تعليق رائع");

    // Check sentiment predictions in Workspace B
    const bSentiment = await db.query<{ label: string; status: string }>(
      "select label, status from public.sentiment_predictions where workspace_id = $1",
      [B],
    );
    expect(bSentiment.rows).toHaveLength(1);
    expect(bSentiment.rows[0].label).toBe("positive");
    expect(bSentiment.rows[0].status).toBe("succeeded");

    // Check video_selections in Workspace B is marked exhausted to avoid re-calling YouTube
    const bSelections = await db.query<{
      last_outcome: string;
      last_seen_comment_count: number;
    }>(
      "select last_outcome, last_seen_comment_count from public.video_selections where workspace_id = $1 and video_id = $2",
      [B, videoBId],
    );
    expect(bSelections.rows).toHaveLength(1);
    expect(bSelections.rows[0].last_outcome).toBe("exhausted");
    expect(bSelections.rows[0].last_seen_comment_count).toBe(1);

    // 5. Check workspace_ops_snapshot for Workspace B
    const opsSnap = await db.query<{
      r: {
        video_counts: Array<{ id: string; total: number; analysed: number }>;
        catalogue_summary: {
          total_comments_collected: number;
          total_comments_analysed: number;
          videos_with_comments: number;
        };
      };
    }>("select private.workspace_ops_snapshot_impl($1) as r", [B]);
    const snap = opsSnap.rows[0].r;
    expect(snap.video_counts).toEqual([
      { id: videoBId, total: 1, analysed: 1 },
    ]);
    expect(snap.catalogue_summary).toEqual({
      total_comments_collected: 1,
      total_comments_analysed: 1,
      videos_with_comments: 1,
    });

    // 6. Test explicit adopt_workspace_channel RPC
    const adoptRes = await db.query<{
      adopt_workspace_channel: Record<string, unknown>;
    }>("select public.adopt_workspace_channel($1, $2)", [B, channelBId]);
    expect(adoptRes.rows[0].adopt_workspace_channel).toBeDefined();
  });
});
