import { describe, expect, it, vi, beforeEach } from "vitest";

const abortSignalMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      refreshSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    rpc: (...args: unknown[]) => {
      const res = rpcMock(...args);
      return {
        then: res.then.bind(res),
        catch: res.catch.bind(res),
        abortSignal: abortSignalMock.mockImplementation(() => res),
      };
    },
  },
}));

import {
  loadDashboardAggregates,
  loadDashboardComments,
  isStatementTimeout,
} from "../data";
import { shouldRetryDashboardQuery } from "./Dashboard";

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

const mockComments = {
  total: 0,
  comments: [],
  limit: 50,
  offset: 0,
  has_more: false,
  next_cursor: null,
};

describe("Dashboard single retry layer and timeout isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("identifies statement timeouts by code and message", () => {
    expect(isStatementTimeout({ code: "57014" })).toBe(true);
    expect(
      isStatementTimeout({
        message: "canceling statement due to statement timeout",
      }),
    ).toBe(true);
    expect(isStatementTimeout(new Error("57014: query canceled"))).toBe(true);
    expect(isStatementTimeout(new Error("network error"))).toBe(false);
    expect(isStatementTimeout(null)).toBe(false);
  });

  it("shouldRetryDashboardQuery refuses to retry statement timeouts or aborts", () => {
    expect(
      shouldRetryDashboardQuery(0, {
        code: "57014",
        message: "statement timeout",
      }),
    ).toBe(false);
    const abortErr = new Error("Aborted");
    abortErr.name = "AbortError";
    expect(shouldRetryDashboardQuery(0, abortErr)).toBe(false);
    expect(
      shouldRetryDashboardQuery(0, new Error("transient network error")),
    ).toBe(true);
    expect(
      shouldRetryDashboardQuery(2, new Error("transient network error")),
    ).toBe(false);
  });

  it("NEVER retries 57014 / statement timeouts at RPC layer", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "57014",
        message: "canceling statement due to statement timeout",
      },
    });

    await expect(loadDashboardAggregates("live", "ws-1", {})).rejects.toThrow();

    // Must be called EXACTLY once — no internal retry loop for 57014
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("passes React Query abortSignal to PostgREST builder in loadDashboardAggregates", async () => {
    rpcMock.mockResolvedValue({
      data: mockAggregates,
      error: null,
    });

    const controller = new AbortController();
    await loadDashboardAggregates("live", "ws-1", {}, controller.signal);

    expect(abortSignalMock).toHaveBeenCalledWith(controller.signal);
  });

  it("passes React Query abortSignal to PostgREST builder in loadDashboardComments", async () => {
    rpcMock.mockResolvedValue({
      data: mockComments,
      error: null,
    });

    const controller = new AbortController();
    await loadDashboardComments(
      "live",
      "ws-1",
      { limit: 50 },
      controller.signal,
    );

    expect(abortSignalMock).toHaveBeenCalledWith(controller.signal);
  });
});
