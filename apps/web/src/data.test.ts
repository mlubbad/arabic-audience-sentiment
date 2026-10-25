import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "./strings/ar";
import { Hero } from "./dashboard/Hero";
import { Summary } from "./dashboard/Summary";
import type { Snapshot } from "./dashboard/Dashboard";

// Simulate a fully configured Supabase project. Product Auth being available
// must not imply that the dashboard's comment data is live.
type RpcResult = { data?: unknown; error: { message?: string } | null };
const rpc = vi.fn<
  (name: string, args?: Record<string, unknown>) => Promise<RpcResult>
>(async () => ({ data: null, error: null }));
vi.mock("./supabase", () => ({ supabase: { rpc } }));

const fixtureJson = readFileSync(
  "apps/web/public/fixtures/dashboard.json",
  "utf8",
);
const fixture = JSON.parse(fixtureJson) as {
  active_analysis_key: string;
  active_topic_key: string;
  comments: { id: string; content_hash: string; text_raw: string }[];
};
const target = fixture.comments[0];

async function loadModule() {
  vi.resetModules();
  return import("./data");
}

beforeEach(() => {
  rpc.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(fixtureJson, { status: 200 })),
  );
});

describe("fixture and live modes stay separate", () => {
  it("does not send a fixture correction to a live RPC when Auth is configured", async () => {
    const { submitReview, fixtureWorkspace, reviewsArePersisted } =
      await loadModule();
    // Fixture rows carry fixture ids and a fixture workspace. No live server
    // would accept them, so the correction must never be addressed to one.
    await submitReview("sanitized_fixture", {
      workspace_id: fixtureWorkspace,
      comment_id: target.id,
      content_hash: target.content_hash,
      label: "negative",
      reason: "تصنيف خاطئ",
    });
    expect(rpc).not.toHaveBeenCalled();
    // The UI must keep telling the truth about persistence.
    expect(reviewsArePersisted("sanitized_fixture")).toBe(false);
  });

  it("keeps the correction in the session view rather than claiming a server wrote it", async () => {
    const { submitReview, loadSnapshot, fixtureWorkspace } = await loadModule();
    await submitReview("sanitized_fixture", {
      workspace_id: fixtureWorkspace,
      comment_id: target.id,
      content_hash: target.content_hash,
      label: "negative",
      reason: "تصنيف خاطئ",
    });
    const view = await loadSnapshot(
      "sanitized_fixture",
      { workspace_id: fixtureWorkspace },
      new AbortController().signal,
    );
    const row = view.comments.find((c) => c.id === target.id)!;
    expect(row.label).toBe("negative");
    expect(row.reviewed).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still refuses a verdict on text that changed, without falling back to the server", async () => {
    const { submitReview, fixtureWorkspace } = await loadModule();
    await expect(
      submitReview("sanitized_fixture", {
        workspace_id: fixtureWorkspace,
        comment_id: target.id,
        content_hash: "hash-of-older-text",
        label: "negative",
        reason: "تصنيف خاطئ",
      }),
    ).rejects.toThrow("stale_comment_text");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports the furthest mode this build is allowed to serve", async () => {
    const { configuredMode } = await loadModule();
    expect(configuredMode).toBe("sanitized_fixture");
  });

  it("cannot be talked into a live read by a session on a demo build", async () => {
    // Configuration is the ceiling. A signed-in user with a real workspace id
    // still gets the fixture here, because this build has no live source to
    // read and addressing one would be a request to a server that was never
    // configured.
    const { resolveMode } = await loadModule();
    expect(
      resolveMode({
        signedIn: true,
        workspace: "9f1f0f38-0000-4000-8000-000000000001",
      }),
    ).toBe("sanitized_fixture");
  });
});

describe("the live path reads and writes against the same source", () => {
  const live = () => ({
    ...JSON.parse(fixtureJson),
    mode: "live",
    revision: "2026-09-13T10:00:00Z",
  });

  beforeEach(() => {
    vi.stubEnv("VITE_DASHBOARD_SOURCE", "live");
  });

  it("reads the snapshot from the server and not from the fixture file", async () => {
    rpc.mockResolvedValueOnce({ data: live(), error: null });
    const { loadSnapshot, configuredMode } = await loadModule();
    expect(configuredMode).toBe("live");
    const view = await loadSnapshot(
      "live",
      { workspace_id: "00000000-0000-4000-8000-000000000001" },
      new AbortController().signal,
    );
    expect(rpc).toHaveBeenCalledWith("dashboard_snapshot", {
      w: "00000000-0000-4000-8000-000000000001",
    });
    // The file is never read in live mode: serving a fixture row beside live
    // ones is how the two would be mistaken for each other.
    expect(fetch).not.toHaveBeenCalled();
    expect(view.total).toBeGreaterThan(0);
    expect(view.mode).toBe("live");
  });

  it("sends a correction to the server, carrying a verdict and no identity", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    const { submitReview } = await loadModule();
    await submitReview("live", {
      workspace_id: "00000000-0000-4000-8000-000000000001",
      comment_id: "aaaaaaaa-0000-4000-8000-000000000001",
      content_hash: "h1",
      label: "negative",
      reason: "تصنيف خاطئ",
    });
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("submit_comment_review");
    expect(args).toBeDefined();
    // The reviewer and the human provenance come from the session inside the
    // RPC. Sending them would let the caller attribute a correction.
    expect(Object.keys(args!).sort()).toEqual([
      "c",
      "seen_hash",
      "verdict",
      "w",
      "why",
    ]);
  });

  it("refuses a server answer of the wrong shape instead of half-rendering it", async () => {
    // A snapshot missing its comments is not an empty dashboard; it is a read
    // that did not happen, and it must not be drawn as zero comments.
    rpc.mockResolvedValueOnce({
      data: { ...live(), comments: undefined },
      error: null,
    });
    const { loadSnapshot } = await loadModule();
    await expect(
      loadSnapshot(
        "live",
        { workspace_id: "00000000-0000-4000-8000-000000000001" },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  it("refuses rows that break the contract even when the shape looks right", async () => {
    // The structural case above would fail without any parsing, because
    // snapshot() cannot walk an undefined list. This one would not: a failed
    // prediction carrying a label is a well-formed object that renders happily
    // as a labelled comment, and only the schema refuses it.
    const payload = live();
    payload.comments[0].prediction = {
      ...payload.comments[0].prediction,
      status: "failed",
      label: "positive",
    };
    rpc.mockResolvedValueOnce({ data: payload, error: null });
    const { loadSnapshot } = await loadModule();
    await expect(
      loadSnapshot(
        "live",
        { workspace_id: "00000000-0000-4000-8000-000000000001" },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  it("does not leak the server's error text to the caller", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "https://project.supabase.co/rest/v1/rpc?apikey=secret",
      },
    });
    const { loadSnapshot } = await loadModule();
    await expect(
      loadSnapshot(
        "live",
        { workspace_id: "00000000-0000-4000-8000-000000000001" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("live_unavailable");
  });

  it("goes live only with a session and a workspace, never with one of them", async () => {
    const { resolveMode } = await loadModule();
    const workspace = "9f1f0f38-0000-4000-8000-000000000001";
    expect(resolveMode({ signedIn: true, workspace })).toBe("live");
    // A workspace id with no session is a claim, not an entitlement: the id
    // could have come from a URL, a stale render or another tenant.
    expect(resolveMode({ signedIn: false, workspace })).toBe(
      "sanitized_fixture",
    );
    // And a session with nothing resolved has no live rows to show. Falling
    // back to the fixture workspace under a live mode would read the demo id
    // from the real server.
    expect(resolveMode({ signedIn: true, workspace: null })).toBe(
      "sanitized_fixture",
    );
  });

  it("says corrections are persisted, because now they are", async () => {
    const { reviewsArePersisted } = await loadModule();
    expect(reviewsArePersisted("live")).toBe(true);
  });
});

describe("a cursor outlives the rows it pointed at", () => {
  // The dashboard holds its cursor in component state and its rows in a cache
  // entry keyed on the workspace. A re-read — a correction invalidating the
  // query, a workspace coming back with fewer rows — can therefore land while
  // the reader is on page two, and name a row that is no longer in the set.
  //
  // Previously this was exercised through the browser by shrinking the fixture
  // between page one and page two. Paging cannot produce it any more, because
  // paging does not re-read; the state is only reachable through a re-read, so
  // the guarantee is tested against the derivation that implements it.
  const ws = "00000000-0000-4000-8000-000000000001";

  it("restarts at page one and says so, rather than showing an empty page", async () => {
    const { loadSource, deriveSnapshot } = await loadModule();
    const source = await loadSource("sanitized_fixture", ws);
    const first = deriveSnapshot(source, "sanitized_fixture", {
      workspace_id: ws,
      limit: 2,
    });
    const cursor = first.comments.at(-1)!.id;

    // Page two of the set as it was: legitimate, and not a reset.
    const second = deriveSnapshot(source, "sanitized_fixture", {
      workspace_id: ws,
      limit: 2,
      cursor,
    });
    expect(second.cursor_reset).toBe(false);
    expect(second.comments[0].id).not.toBe(first.comments[0].id);

    // The same cursor against a set that no longer contains it.
    const shrunk = {
      ...source,
      comments: source.comments.filter((c) => c.id !== cursor),
    };
    const recovered = deriveSnapshot(shrunk, "sanitized_fixture", {
      workspace_id: ws,
      limit: 2,
      cursor,
    });
    expect(recovered.cursor_reset).toBe(true);
    // Page one of the new set, not an empty page and not a page from the old one.
    expect(recovered.comments).toHaveLength(2);
    expect(recovered.comments[0].id).toBe(first.comments[0].id);
  });

  it("does not report a reset when no cursor was asked for", async () => {
    const { loadSource, deriveSnapshot } = await loadModule();
    const source = await loadSource("sanitized_fixture", ws);
    const view = deriveSnapshot(source, "sanitized_fixture", {
      workspace_id: ws,
      limit: 2,
    });
    expect(view.cursor_reset).toBe(false);
  });

  it("derives without reading, so a filter costs no request", async () => {
    // The reason the whole page was rewritten: the read takes a workspace and
    // the filters are applied to what it returned. Counting the reads is the
    // only way to state that as a fact rather than an intention.
    const { loadSource, deriveSnapshot } = await loadModule();
    const source = await loadSource("sanitized_fixture", ws);
    const readsAfterLoad = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls.length;
    for (const limit of [1, 2, 3, 5]) {
      deriveSnapshot(source, "sanitized_fixture", { workspace_id: ws, limit });
    }
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(readsAfterLoad);
  });
});

describe("a topic correction in fixture mode", () => {
  // The same rules as the sentiment path, on the topic dimension: kept in the
  // session, never sent, and refused against text that changed.
  it("refuses a verdict on text that changed, without falling back to the server", async () => {
    const { submitTopicReview, fixtureWorkspace } = await loadModule();
    await expect(
      submitTopicReview("sanitized_fixture", {
        workspace_id: fixtureWorkspace,
        comment_id: target.id,
        content_hash: "hash-of-older-text",
        topic_key: "question",
        reason: "يسأل عن مصدر المعلومة",
      }),
    ).rejects.toThrow("stale_comment_text");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the correction in the session view as one topic review", async () => {
    const { submitTopicReview, loadSource, fixtureWorkspace } =
      await loadModule();
    await submitTopicReview("sanitized_fixture", {
      workspace_id: fixtureWorkspace,
      comment_id: target.id,
      content_hash: target.content_hash,
      topic_key: "question",
      reason: "يسأل عن مصدر المعلومة",
    });
    const source = await loadSource("sanitized_fixture", fixtureWorkspace);
    const row = source.comments.find((c) => c.id === target.id)!;
    expect(row.topic_reviews).toHaveLength(1);
    expect(row.topic_reviews[0].topic_key).toBe("question");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("loadOpsSource operational snapshot", () => {
  it("computes video counts and returns ops state in fixture mode", async () => {
    const { loadOpsSource, fixtureWorkspace } = await loadModule();
    const ops = await loadOpsSource("sanitized_fixture", fixtureWorkspace);
    expect(ops.sync).toBeDefined();
    expect(ops.plan).toBeDefined();
    expect(ops.video_counts.length).toBeGreaterThan(0);
    expect(ops.video_counts[0]).toHaveProperty("id");
    expect(ops.video_counts[0]).toHaveProperty("total");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls workspace_ops_snapshot RPC in live mode", async () => {
    const { loadOpsSource } = await loadModule();
    const mockOps = {
      sync: {
        worker: { connected: true, last_heartbeat_at: null, busy: false },
        queued_jobs: 0,
        last_run: null,
      },
      plan: null,
      video_counts: [{ id: "vid-1", total: 42 }],
    };
    rpc.mockResolvedValueOnce({ data: mockOps, error: null });

    const ops = await loadOpsSource(
      "live",
      "00000000-0000-4000-8000-000000000001",
    );
    expect(rpc).toHaveBeenCalledWith("workspace_ops_snapshot", {
      w: "00000000-0000-4000-8000-000000000001",
    });
    expect(ops.video_counts).toEqual([{ id: "vid-1", total: 42 }]);
  });

  it("throws live_unavailable when RPC returns error", async () => {
    const { loadOpsSource } = await loadModule();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "timeout" } });

    await expect(
      loadOpsSource("live", "00000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow("live_unavailable");
  });
});

describe("loadDashboardComments multi-platform source compatibility", () => {
  it("successfully parses comments with telegram_mtproto and other sources in live mode", async () => {
    const { loadDashboardComments } = await loadModule();
    const commentWithTelegramSource = {
      id: "tg_msg_100",
      workspace_id: "00000000-0000-4000-8000-000000000001",
      client_id: "client",
      channel_id: "channel",
      video_id: "post_1",
      video_title: "منشور تيليجرام",
      platform: "telegram",
      video_kind: "channel_post",
      author_channel_id: "user_1",
      by_channel_owner: false,
      author_name: "متابع",
      text_raw: "تعليق من تيليجرام",
      content_hash: "hash_tg_1",
      likes_raw: null,
      likes_value: null,
      published_at: "2026-09-23T10:00:00Z",
      published_time_raw: "2026-09-23T10:00:00Z",
      timestamp_precision: "second",
      is_reply: false,
      parent_comment_id: null,
      parent_source: "unknown",
      source: "telegram_mtproto",
      field_provenance: {},
      comment_type: null,
      content_purged_at: null,
      prediction: null,
      reviews: [],
      topic_prediction: null,
      topic_reviews: [],
    };
    const mockRpcResponse = {
      total: 1,
      comments: [commentWithTelegramSource],
      limit: 50,
      offset: 0,
      has_more: false,
      next_cursor: null,
    };
    rpc.mockResolvedValueOnce({ data: mockRpcResponse, error: null });

    const result = await loadDashboardComments(
      "live",
      "00000000-0000-4000-8000-000000000001",
      { limit: 50 },
    );
    expect(result.total).toBe(1);
    expect(result.comments[0].source).toBe("telegram_mtproto");
    expect(result.comments[0].platform).toBe("telegram");
  });
});

describe("loadDashboardAggregates null channel handling", () => {
  it("successfully parses live aggregates when workspace has no channel (channel: null)", async () => {
    const { loadDashboardAggregates } = await loadModule();
    const mockAggregates = {
      workspace_total: 0,
      channel_own_comments: 0,
      total: 0,
      analysed: 0,
      unanalysed: 0,
      sentiments: { positive: 0, negative: 0, neutral: 0, mixed: 0 },
      kpis: {
        total_views: 0,
        total_likes: 0,
        total_comments: 0,
        engagement_rate: null,
        net_sentiment: null,
      },
      channel: null,
      measurable: ["positive", "negative", "neutral", "mixed"],
      negative_ranked: 0,
      negative_unranked: 0,
      timeline: {},
      topic_counts: {},
      platform_breakdown: {},
      videos: [],
      hours: [],
      weekdays: [],
      weeks: [],
      people: [],
      most_engaged_negative: [],
      comment_types: [],
      video_options: [],
      topics: [],
      active_analysis_key: null,
      active_topic_key: null,
      revision: "empty",
    };
    rpc.mockResolvedValueOnce({ data: mockAggregates, error: null });

    const result = await loadDashboardAggregates(
      "live",
      "00000000-0000-4000-8000-000000000001",
    );
    expect(result.channel).toBeNull();
    expect(result.total).toBe(0);
    expect(result.kpis?.total_comments).toBe(0);
  });

  describe("buildExport cap and deriveSnapshot kpis", () => {
    const liveAggregates = (total: number) => ({
      workspace_total: total,
      channel_own_comments: 0,
      total,
      analysed: total,
      unanalysed: 0,
      replies: 0,
      unknown_dates: 0,
      unique_authors: total,
      sentiments: { positive: total, negative: 0, neutral: 0, mixed: 0 },
      measurable: ["positive", "negative", "neutral", "mixed"],
      negative_ranked: 0,
      negative_unranked: 0,
      timeline: {},
      topic_counts: {},
      platform_breakdown: {},
      videos: [],
      hours: [],
      weekdays: [],
      weeks: [],
      people: [],
      most_engaged_negative: [],
      comment_types: [],
      video_options: [],
      topics: [],
      active_analysis_key: fixture.active_analysis_key,
      active_topic_key: fixture.active_topic_key,
      revision: "export-test",
    });

    it("buildExport returns rows capped at EXPORT_ROW_CAP and flags truncation", async () => {
      const { buildExport, EXPORT_ROW_CAP } = await loadModule();
      expect(EXPORT_ROW_CAP).toBe(10_000);

      // Create a large fixture with 10_005 comments
      const manyComments = Array.from({ length: 10_005 }, (_, i) => ({
        ...target,
        id: `comment_${i}`,
        content_hash: `hash_${i}`,
        text_raw: `تعليق رقم ${i}`,
        published_at: "2026-09-20T00:00:00Z",
      }));
      const largeFixture = JSON.stringify({
        ...JSON.parse(fixtureJson),
        comments: manyComments,
      });

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(largeFixture, { status: 200 })),
      );

      const result = await buildExport("sanitized_fixture", {
        workspace_id: "00000000-0000-4000-8000-000000000001",
      });

      expect(result.totalRows).toBe(10_005);
      expect(result.rows).toBe(10_000);
      expect(result.truncated).toBe(true);
      expect(result.csv.split("\n").length).toBe(10_002); // Header + 10,000 rows + trailing empty line
    });

    it("pages through every filtered live row instead of reading dashboard_snapshot", async () => {
      const { buildExport } = await loadModule();
      const total = 1_601;
      const comments = Array.from({ length: total }, (_, index) => ({
        ...target,
        id: `live_${index}`,
        content_hash: `live_hash_${index}`,
        text_raw: `مطابق ${index}`,
      }));

      rpc.mockImplementation(async (name, args) => {
        if (name === "dashboard_aggregates") {
          return { data: liveAggregates(total), error: null };
        }
        if (name === "dashboard_comments") {
          const f = args?.f as {
            limit: number;
            offset?: number;
            after?: string;
            with_total?: string;
            q: string;
            video: string;
          };
          const start = f.after ? Number(f.after.slice("cursor-".length)) : 0;
          const page = comments.slice(start, start + f.limit);
          const next = start + page.length;
          return {
            data: {
              total: f.with_total === "false" ? null : total,
              comments: page,
              limit: f.limit,
              offset: f.offset ?? 0,
              has_more: next < total,
              next_cursor: next < total ? `cursor-${next}` : null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      });

      const result = await buildExport("live", {
        workspace_id: "00000000-0000-4000-8000-000000000001",
        video_ids: ["video-filter"],
        q: "مطابق",
      });

      expect(result.totalRows).toBe(total);
      expect(result.rows).toBe(total);
      expect(result.truncated).toBe(false);
      expect(result.csv.split("\n")).toHaveLength(total + 2);
      expect(
        rpc.mock.calls.some(([name]) => name === "dashboard_snapshot"),
      ).toBe(false);
      const pageCalls = rpc.mock.calls.filter(
        ([name]) => name === "dashboard_comments",
      );
      expect(pageCalls).toHaveLength(17);
      const firstFilters = pageCalls[0][1]?.f as Record<string, unknown>;
      expect(firstFilters).toMatchObject({ offset: 0 });
      expect(firstFilters).not.toHaveProperty("after");
      expect(firstFilters).not.toHaveProperty("with_total");
      for (const [, args] of pageCalls.slice(1)) {
        expect(args?.f).toMatchObject({
          after: expect.stringMatching(/^cursor-/),
          with_total: "false",
        });
        expect(args?.f).not.toHaveProperty("offset");
      }
      expect(
        pageCalls.every(([, args]) => {
          const f = args?.f as { q?: string; video?: string };
          return f.q === "مطابق" && f.video === "video-filter";
        }),
      ).toBe(true);
    });

    it("caps a live export and marks the filename with the exported fraction", async () => {
      const { buildExport, EXPORT_ROW_CAP } = await loadModule();
      const total = EXPORT_ROW_CAP + 37;

      rpc.mockImplementation(async (name, args) => {
        if (name === "dashboard_aggregates") {
          return { data: liveAggregates(total), error: null };
        }
        if (name === "dashboard_comments") {
          const f = args?.f as {
            limit: number;
            offset?: number;
            after?: string;
            with_total?: string;
          };
          const start = f.after ? Number(f.after.slice("cursor-".length)) : 0;
          const count = Math.min(f.limit, total - start);
          const comments = Array.from({ length: count }, (_, index) => ({
            ...target,
            id: `capped_${start + index}`,
            content_hash: `capped_hash_${start + index}`,
          }));
          const next = start + count;
          return {
            data: {
              total: f.with_total === "false" ? null : total,
              comments,
              limit: f.limit,
              offset: f.offset ?? 0,
              has_more: next < total,
              next_cursor: next < total ? `cursor-${next}` : null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      });

      const result = await buildExport("live", {
        workspace_id: "00000000-0000-4000-8000-000000000001",
      });

      expect(result.totalRows).toBe(total);
      expect(result.rows).toBe(EXPORT_ROW_CAP);
      expect(result.truncated).toBe(true);
      expect(result.filename).toMatch(
        new RegExp(`-first-${EXPORT_ROW_CAP}-of-${total}\\.csv$`),
      );
      expect(result.csv.split("\n")).toHaveLength(EXPORT_ROW_CAP + 2);
      const pageCalls = rpc.mock.calls.filter(
        ([name]) => name === "dashboard_comments",
      );
      expect(pageCalls).toHaveLength(EXPORT_ROW_CAP / 100);
      expect(pageCalls[1][1]?.f).toMatchObject({
        after: "cursor-100",
        with_total: "false",
      });
    });

    it("renders unknown reply and author KPIs as an em dash", async () => {
      const dashboardSource = readFileSync(
        "apps/web/src/dashboard/Dashboard.tsx",
        "utf8",
      );
      expect(dashboardSource).toContain("replies: agg.replies ?? null");

      const { deriveSnapshot, loadSource } = await loadModule();
      const source = await loadSource(
        "sanitized_fixture",
        "00000000-0000-4000-8000-000000000001",
      );
      const base = deriveSnapshot(source, "sanitized_fixture", {
        workspace_id: "00000000-0000-4000-8000-000000000001",
      });
      const unknown = {
        ...base,
        replies: null,
        unknown_dates: null,
        unique_authors: null,
      } as unknown as Snapshot;

      const summary = renderToStaticMarkup(
        createElement(Summary, { s: unknown, S: ar }),
      );
      const hero = renderToStaticMarkup(
        createElement(Hero, {
          s: unknown,
          S: ar,
          workspaceName: "مساحة اختبار",
          range: "كل الوقت",
          labels: {
            positive: "إيجابي",
            negative: "سلبي",
            neutral: "محايد",
            mixed: "مختلط",
          },
        }),
      );

      expect(summary).toContain('data-testid="replies-count">—</strong>');
      expect(summary).toMatch(
        new RegExp(`>—</strong><span class="db-kpi-label">${ar.metricAuthors}`),
      );
      expect(hero).toContain(">—</span>");
      expect(hero).not.toContain(ar.pillAuthors("0"));
    });

    it("deriveSnapshot preserves total_likes from base kpis", async () => {
      const { deriveSnapshot } = await loadModule();
      const mockSource = {
        revision: "rev1",
        comments: [
          {
            ...target,
            id: "c1",
            likes_value: 42,
            published_at: "2026-09-20T00:00:00Z",
          },
          {
            ...target,
            id: "c2",
            likes_value: 58,
            published_at: "2026-09-20T00:00:00Z",
          },
        ],
        active_analysis_key: null,
        active_analysis_labels: ["positive", "negative", "neutral"],
        active_topic_key: null,
        cursor_reset: false,
      };

      // @ts-expect-error minimal mock source
      const snapshot = deriveSnapshot(mockSource, "sanitized_fixture", {
        workspace_id: "00000000-0000-4000-8000-000000000001",
      });

      expect(snapshot.kpis?.total_likes).toBe(100);
      expect(snapshot.kpis?.total_comments).toBe(2);
    });
  });
});
