// @vitest-environment jsdom
/** The catalogue, driven: the kind tabs narrow the rows, the page actions
 *  tick and clear, the bar prices what is ticked and refuses what the plan
 *  cannot pay for. The read is forced through a mocked `useQuery`, the way
 *  the empty-state tests below always did; there is no server here, so the
 *  save button's enablement is the only part of saving that is asserted —
 *  the same part the browser suite asserts on in fixture mode.
 */
import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UsageSummary } from "@sentiment/contracts";
import { ar } from "../strings/ar";
import { en } from "../strings/en";
import { explainCode, type JobRow } from "../jobFeed";

const shared = vi.hoisted(() => ({
  query: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    refetch: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => shared.query,
}));
vi.mock("../supabase", () => ({ supabase: null }));

import { Catalogue, savedFeedback } from "./Catalogue";

type Props = Parameters<typeof Catalogue>[0];
const props = (over: Partial<Props> = {}): Props => ({
  mode: "live",
  workspaceId: "w1",
  plan: null,
  stored: [],
  jobs: null,
  workerConnected: true,
  onChanged: () => {},
  ...over,
});

const job = (over: Partial<JobRow> = {}): JobRow => ({
  id: "j1",
  type: "discover",
  status: "queued",
  attempt: 0,
  error_code: null,
  created_at: "2026-09-15T00:00:00Z",
  ...over,
});

/** The static render the empty-state tests read as text. */
const markup = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(createElement(Catalogue, props(over)));

/** The browser fixture's five videos and two stored selections, so the
 *  figures here are the figures `dashboard.spec.ts` asserts on. */
const video = (
  id: string,
  kind: "video" | "short" | "stream",
  reported: number | null,
  comments_state: "open" | "disabled" | "unknown" = "open",
) => ({
  id,
  external_video_id: `fixture${id.slice(-1).padStart(4, "0")}`,
  title: `عنوان ${id}`,
  kind,
  published_at: "2026-09-01T10:00:00Z",
  thumbnail_url: null,
  reported_comment_count: reported,
  comments_state,
});
const fixture = () => ({
  channelId: "ch1",
  cataloguedAt: "2026-09-14T06:00:00Z",
  videos: [
    video("video-1", "video", 7),
    video("video-2", "short", 3),
    video("video-3", "stream", 18),
    video("video-4", "video", null, "disabled"),
    video("video-5", "video", null, "unknown"),
  ],
  selections: [
    {
      video_id: "video-1",
      last_collected_at: "2026-09-14T06:10:00Z",
      last_outcome: "exhausted",
      next_check_at: null,
    },
    {
      video_id: "video-2",
      last_collected_at: "2026-09-14T06:12:00Z",
      last_outcome: "exhausted",
      next_check_at: null,
    },
  ],
});
const plan = (remaining: number): UsageSummary => ({
  plan_key: "growth",
  status: "active",
  period_start: "2026-09-01T00:00:00Z",
  period_end: "2026-10-01T00:00:00Z",
  budgets: [
    {
      event_type: "comment_analysis",
      used: 100 - remaining,
      allowance: 100,
      granted: 0,
      remaining,
    },
  ],
  cancel_at_period_end: false,
  billing_interval: null,
  provider: null,
});
const stored = [
  { id: "video-1", total: 5 },
  { id: "video-2", total: 2 },
];

const rows = () => screen.getAllByTestId(/^cat-row-/);
const box = (id: string) => screen.getByTestId(`cat-check-${id}`);

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
    refetch: vi.fn(() => Promise.resolve()),
  };
});

describe("the catalogue, driven", () => {
  beforeEach(() => {
    shared.query.data = fixture();
  });

  it("narrows the rows by kind through the tabs, and counts each kind on its tab", async () => {
    render(<Catalogue {...props({ stored, plan: plan(26) })} />);
    expect(rows()).toHaveLength(5);
    const short = screen.getByTestId("cat-kind-short");
    expect(short).toHaveAttribute("role", "tab");
    // A filter, not a tab over a panel: it points at no content.
    expect(short).not.toHaveAttribute("aria-controls");
    expect(short).toHaveTextContent(`${ar.catKindShort} (1)`);
    await userEvent.click(short);
    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId("cat-row-video-2")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("cat-kind-all"));
    expect(rows()).toHaveLength(5);
    expect(screen.getByTestId("cat-kind-all")).toHaveTextContent(
      `${ar.catKindAll} (5)`,
    );
  });

  it("each row's box is a real checkbox named by the title, off for a disabled video", () => {
    render(<Catalogue {...props({ stored, plan: plan(26) })} />);
    const b = box("video-3");
    expect(b).toHaveAttribute("role", "checkbox");
    expect(b).toHaveAccessibleName("عنوان video-3");
    expect(b).not.toBeChecked();
    // Stored selections arrive ticked.
    expect(box("video-1")).toBeChecked();
    expect(box("video-2")).toBeChecked();
    expect(box("video-4")).toBeDisabled();
    expect(screen.getByTestId("cat-state-video-4")).toHaveTextContent(
      ar.catStateDisabled,
    );
    expect(
      within(screen.getByTestId("cat-row-video-2")).getByRole("link"),
    ).toHaveAttribute("href", "https://www.youtube.com/shorts/fixture0002");
  });

  it("selecting the page ticks what is shown except the disabled, and clearing unticks the stored too", async () => {
    render(<Catalogue {...props({ stored, plan: plan(26) })} />);
    // Clean: nothing to save.
    expect(screen.getByTestId("cat-save")).toBeDisabled();
    await userEvent.click(screen.getByTestId("cat-select-page"));
    expect(box("video-3")).toBeChecked();
    expect(box("video-5")).toBeChecked();
    expect(box("video-4")).not.toBeChecked();
    await userEvent.click(screen.getByTestId("cat-clear"));
    for (const id of ["video-1", "video-2", "video-3", "video-4", "video-5"])
      expect(box(id)).not.toBeChecked();
    // Removing the stored two is a change worth saving.
    expect(screen.getByTestId("cat-save")).toBeEnabled();
  });

  it("prices the selection live against the plan's remainder", async () => {
    render(<Catalogue {...props({ stored, plan: plan(26) })} />);
    const bar = screen.getByTestId("cat-estimate");
    // The stored two still owe 3 (7 of 5, 3 of 2) before anything is ticked.
    expect(bar).toHaveTextContent(ar.catSelected(2, 3));
    expect(bar).toHaveTextContent(ar.catRemainingAfter(23));
    expect(bar).toHaveAttribute("data-exceeds", "false");
    await userEvent.click(box("video-3"));
    expect(bar).toHaveTextContent(ar.catSelected(3, 21));
    expect(bar).toHaveTextContent(ar.catRemainingAfter(5));
    await userEvent.click(box("video-5"));
    expect(bar).toHaveTextContent(ar.catUnknownCount(1));
    expect(screen.getByTestId("cat-save")).toBeEnabled();
  });

  it("refuses a selection the plan cannot pay for, and says so", async () => {
    render(<Catalogue {...props({ stored, plan: plan(10) })} />);
    await userEvent.click(box("video-3"));
    const bar = screen.getByTestId("cat-estimate");
    expect(bar).toHaveAttribute("data-exceeds", "true");
    expect(bar).toHaveTextContent(ar.catExceeds);
    expect(screen.getByTestId("cat-save")).toBeDisabled();
    // Fit: nothing fits 10 units, so video-3 comes off.
    await userEvent.click(screen.getByTestId("cat-fit"));
    expect(box("video-3")).not.toBeChecked();
    expect(screen.getByTestId("cat-save")).toBeDisabled();
  });

  it("a plan with no ceiling never exceeds: the bar says so, the save is offered, and the fit takes everything priceable", async () => {
    // The owner's plan as usage_summary reports it: -1 on both sides.
    const owner: UsageSummary = {
      ...plan(0),
      plan_key: "owner",
      budgets: [
        {
          event_type: "comment_analysis",
          used: 68,
          allowance: -1,
          granted: 0,
          remaining: -1,
        },
      ],
    };
    render(<Catalogue {...props({ stored, plan: owner })} />);
    const bar = screen.getByTestId("cat-estimate");
    expect(bar).toHaveTextContent(ar.pricingUnlimited);
    expect(bar).not.toHaveTextContent(ar.catExceeds);
    await userEvent.click(box("video-3"));
    expect(bar).toHaveTextContent(ar.catSelected(3, 21));
    expect(bar).toHaveAttribute("data-exceeds", "false");
    expect(screen.getByTestId("cat-save")).toBeEnabled();
    // Fit: with no ceiling everything that can be priced fits — video-3 comes
    // back on; the disabled video-4 and the unpriced video-5 stay off.
    await userEvent.click(box("video-3"));
    expect(box("video-3")).not.toBeChecked();
    await userEvent.click(screen.getByTestId("cat-fit"));
    expect(box("video-3")).toBeChecked();
    expect(box("video-4")).not.toBeChecked();
    expect(box("video-5")).not.toBeChecked();
    expect(screen.getByTestId("cat-save")).toBeEnabled();
  });

  it("with no plan there is no quota to measure against, and the fit is off", () => {
    render(<Catalogue {...props({ stored })} />);
    expect(screen.getByTestId("cat-estimate")).toHaveTextContent(ar.catNoPlan);
    expect(screen.getByTestId("cat-fit")).toBeDisabled();
  });

  it("opens the player from a row and closes it without touching the ticks", async () => {
    render(<Catalogue {...props({ stored, plan: plan(26) })} />);
    expect(screen.queryByTestId("cat-preview-frame")).not.toBeInTheDocument();
    await userEvent.click(box("video-3"));
    await userEvent.click(screen.getByTestId("cat-open-video-3"));
    const dialog = await screen.findByTestId("cat-preview");
    expect(within(dialog).getByRole("heading", { level: 3 })).toHaveTextContent(
      "عنوان video-3",
    );
    expect(screen.getByTestId("cat-preview-frame")).toHaveAttribute(
      "src",
      expect.stringContaining("youtube-nocookie.com/embed/fixture0003"),
    );
    await userEvent.click(screen.getByTestId("cat-preview-close"));
    expect(screen.queryByTestId("cat-preview")).not.toBeInTheDocument();
    expect(box("video-3")).toBeChecked();
  });
});

describe("the catalogue before it exists", () => {
  it("says where the discover job is, in the attempt log's words", () => {
    const html = markup({ jobs: [job()] });
    expect(html).toContain('data-testid="cat-discovering"');
    expect(html).toContain(ar.jobQueuedHeadline);
    expect(html).toContain(ar.jobCatalogueQueuedWithWorker);
    expect(html).not.toContain(ar.catEmpty);
    // With no worker the same job reads as the log reads it: stalled.
    const stalled = markup({ jobs: [job()], workerConnected: false });
    expect(stalled).toContain(ar.jobQueuedNoWorker);
    expect(stalled).toContain('data-severity="critical"');
    // Running, too — the job is under way, not waiting.
    expect(markup({ jobs: [job({ status: "running" })] })).toContain(
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
      const html = markup({ jobs });
      expect(html).toContain('data-testid="cat-empty"');
      expect(html).toContain(ar.catEmpty);
      expect(html).not.toContain("cat-discovering");
    }
  });

  it("offers to build the list only where the server would accept", () => {
    // Live, connected: the refresh is on. Live with no channel: off, like the
    // save button — a call that would be refused is not offered.
    const on = markup();
    expect(on).toMatch(/data-testid="cat-refresh"(?![^>]*disabled)/);
    shared.query.data = { ...(shared.query.data as object), channelId: null };
    const off = markup();
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
  const one = (id: string) => ({
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
      videos: [one("v1")],
      selections: [selection("v1", last_outcome)],
      channelId: "ch1",
      cataloguedAt: "2026-09-16T00:00:00Z",
    };
    const html = markup({ stored: [{ id: "v1", total: 12 }] });
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

  it("renders warning state when Telegram discussion requires auth", () => {
    expect(cell("telegram_discussion_requires_auth")).toBe(
      ar.catStateTelegramAuthRequired,
    );
  });
});

describe("reactive lifecycle updates", () => {
  it("refetches catalogue when a discover job transitions from running to finished", () => {
    const refetch = vi.fn(() => Promise.resolve());
    shared.query.refetch = refetch;

    const { rerender } = render(
      <Catalogue {...props({ jobs: [job({ status: "running" })] })} />,
    );
    expect(refetch).not.toHaveBeenCalled();

    // The discover job finishes: jobs now has a succeeded job (or no active job)
    rerender(
      <Catalogue {...props({ jobs: [job({ status: "succeeded" })] })} />,
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("refetches catalogue when an active collect job transitions from running to finished", () => {
    const refetch = vi.fn(() => Promise.resolve());
    shared.query.refetch = refetch;

    const { rerender } = render(
      <Catalogue
        {...props({
          jobs: [job({ type: "collect", status: "running" })],
        })}
      />,
    );
    expect(refetch).not.toHaveBeenCalled();

    // The collect job finishes
    rerender(
      <Catalogue
        {...props({
          jobs: [job({ type: "collect", status: "succeeded" })],
        })}
      />,
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("refetches when catalogue is uncatalogued but a succeeded discover job exists", () => {
    const refetch = vi.fn(() => Promise.resolve());
    shared.query.refetch = refetch;
    shared.query.data = {
      videos: [],
      selections: [],
      channelId: "ch1",
      cataloguedAt: null,
    };

    render(<Catalogue {...props({ jobs: [job({ status: "succeeded" })] })} />);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
