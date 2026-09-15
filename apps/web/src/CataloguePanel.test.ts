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
import { ar } from "./strings/ar";
import type { JobRow } from "./jobFeed";

const shared = vi.hoisted(() => ({
  query: { data: undefined as unknown, isPending: false, isError: false },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => shared.query,
}));
vi.mock("./supabase", () => ({ supabase: null }));

import { Catalogue } from "./CataloguePanel";

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
