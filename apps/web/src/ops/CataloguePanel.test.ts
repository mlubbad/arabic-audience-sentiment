/** The catalogue's empty states, rendered from forced reads.
 *
 * The browser suite runs in fixture mode, where there is no job table, so the
 * one state it cannot reach is "no catalogue yet, and a discover job on the
 * way". That state is rendered here with the read forced, the way the rail's
 * collection line is in RailState.test.ts.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "../strings/ar";
import { en } from "../strings/en";
import { explainCode, type JobRow } from "../jobFeed";

const shared = vi.hoisted(() => ({
  query: { data: undefined as unknown, isPending: false, isError: false },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => shared.query,
}));
vi.mock("../supabase", () => ({ supabase: null }));

import { Catalogue, savedFeedback } from "./CataloguePanel";

const job = (over: Partial<JobRow> = {}): JobRow => ({
  id: "j1",
  type: "discover",
  status: "queued",
  attempt: 0,
  error_code: null,
  created_at: "2026-09-15T00:00:00Z",
  ...over,
});

const render = (over: Partial<Parameters<typeof Catalogue>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(Catalogue, {
      mode: "live",
      workspaceId: "w1",
      plan: null,
      stored: [],
      jobs: null,
      workerConnected: true,
      onChanged: () => {},
      ...over,
    }),
  );

beforeEach(() => {
  shared.query = {
    data: {
      videos: [],
      selections: [],
      channelId: "ch1",
      cataloguedAt: null,
    },
    isPending: false,
    isError: false,
  };
});

describe("the catalogue before it exists", () => {
  it("says where the discover job is, in the attempt log's words", () => {
    const html = render({ jobs: [job()] });
    expect(html).toContain('data-testid="cat-discovering"');
    expect(html).toContain(ar.jobQueuedHeadline);
    expect(html).toContain(ar.jobQueuedWithWorker);
    expect(html).not.toContain(ar.catEmpty);
    // With no worker the same job reads as the log reads it: stalled.
    const stalled = render({ jobs: [job()], workerConnected: false });
    expect(stalled).toContain(ar.jobQueuedNoWorker);
    expect(stalled).toContain('data-severity="critical"');
    // Running, too — the job is under way, not waiting.
    expect(render({ jobs: [job({ status: "running" })] })).toContain(
      ar.jobRunningHeadline,
    );
  });

  it("falls back to the plain empty state when no discover job is on the way", () => {
    // No jobs at all, a finished discover job, and a collect job that is
    // queued — none of them is a catalogue being built.
    for (const jobs of [
      null,
      [],
      [job({ status: "succeeded" })],
      [job({ type: "collect" })],
    ]) {
      const html = render({ jobs });
      expect(html).toContain('data-testid="cat-empty"');
      expect(html).toContain(ar.catEmpty);
      expect(html).not.toContain("cat-discovering");
    }
  });

  it("offers to build the list only where the server would accept", () => {
    // Live, connected: the refresh is on. Live with no channel: off, like the
    // save button — a call that would be refused is not offered.
    const on = render();
    expect(on).toMatch(/data-testid="cat-refresh"(?![^>]*disabled)/);
    shared.query.data = { ...(shared.query.data as object), channelId: null };
    const off = render();
    expect(off).toMatch(/data-testid="cat-refresh"[^>]*disabled/);
  });
});

describe("what the panel says after a save", () => {
  // The four answers select_videos gives, each its own sentence. The static
  // render cannot press the button, so the sentence is chosen by a function
  // the button calls, and that is what is asserted.
  const r = (over: Partial<Parameters<typeof savedFeedback>[0]>) => ({
    queued: false,
    deferred: false,
    already_running: false,
    ...over,
  });
  it("names the collection that was requested, deferred, already running, or not needed", () => {
    expect(savedFeedback(r({ queued: true }), ar)).toBe(ar.catSaved);
    expect(savedFeedback(r({ deferred: true }), ar)).toBe(ar.catSavedDeferred);
    // A run under way took its due list when it was claimed: the new video
    // is not in it, and the sentence must not say otherwise.
    expect(savedFeedback(r({ already_running: true }), ar)).toBe(
      ar.catSavedRunning,
    );
    // A removal alone: saved, and nothing about collection.
    expect(savedFeedback(r({}), ar)).toBe(ar.catSavedRemoved);
    expect(ar.catSavedRemoved).not.toContain("الجمع");
  });
});

describe("what a selected video's state cell says", () => {
  // The live check defers a video whose comment count has not moved since
  // its last read and records 'unchanged'. That is a read that is up to
  // date, not a failure; the cell must not file it under "partial".
  const video = (id: string) => ({
    id,
    external_video_id: "a".repeat(11),
    title: id,
    kind: "video",
    published_at: null,
    thumbnail_url: null,
    reported_comment_count: 12,
    comments_state: "open",
  });
  const selection = (video_id: string, last_outcome: string | null) => ({
    video_id,
    last_collected_at: "2026-09-16T10:00:00Z",
    last_outcome,
    next_check_at: null,
  });
  const cell = (last_outcome: string | null) => {
    shared.query.data = {
      videos: [video("v1")],
      selections: [selection("v1", last_outcome)],
      channelId: "ch1",
      cataloguedAt: "2026-09-16T00:00:00Z",
    };
    const html = render({ stored: [{ id: "v1", total: 12 }] });
    return html.match(/data-testid="cat-state-v1"[^>]*>([^<]*)</)?.[1] ?? "";
  };

  it("reads an unchanged video as healthy, in its own words", () => {
    expect(cell("unchanged")).toBe(ar.catStateUnchanged);
    expect(cell("unchanged")).not.toContain(ar.catStatePartial);
    expect(cell("unchanged")).not.toContain("unchanged");
    // The exhausted read, for comparison: collected, with its date.
    expect(cell("exhausted")).toContain("12");
    expect(cell("exhausted")).not.toContain(ar.catStatePartial);
    // A read that stopped early is still the problem it was.
    expect(cell("partial")).toContain(ar.catStatePartial);
    expect(cell("source_rate_limited")).toContain(ar.catStatePartial);
  });

  it("has the sentence in both languages, short and without the code", () => {
    for (const S of [ar, en]) {
      expect(S.catStateUnchanged.length).toBeLessThan(40);
      expect(S.catStateUnchanged).not.toContain("unchanged");
      // Reached through the code table too, should a path still hand the
      // outcome to it.
      expect(explainCode("unchanged", S)).toBe(S.catStateUnchanged);
    }
  });
});
