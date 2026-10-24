// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const state = vi.hoisted(() => ({
  signedIn: true,
  available: { switch_on: true, plan_allows: true },
  pending: false,
  channels: [{ id: "a", title: "A", platform: "youtube" }],
  overlap: {
    status: "ready" as string,
    computed_at: "2026-10-20T10:00:00Z",
    universe_size: 1000,
    thresholds: { min_audience: 100, min_shared: 10 },
    channel: { id: "a", title: "A", platform: "youtube", audience_size: 500 },
    others: [
      {
        channel_id: "b",
        title: "B",
        handle: null,
        platform: "youtube",
        audience_size: 300,
        below_threshold: false,
        shared: 60,
        share_of_mine: 0.12,
        share_of_mine_ci: { low: 0.09, high: 0.15 },
        share_of_theirs: 0.2,
        overlap_coefficient: 0.2,
        affinity: 120,
      },
    ],
  },
  videosCalls: [] as unknown[][],
}));
vi.mock("../session", () => ({
  useSession: () => ({
    session: state.signedIn ? { user: { id: "u" } } : null,
  }),
  useWorkspaces: () => ({ workspaces: [{ id: "w" }] }),
}));
vi.mock("../strings", () => ({
  useStrings: () => ({
    titleAudience: "Shared audience",
    audienceDemo: "Sign in to see overlap",
    audienceChoose: "Choose channel",
    audienceUnavailable: "This section isn't available",
    audienceError: "Audience error",
    audiencePending: "Measuring… first figures within 30 minutes",
    audienceNoOther: "Add a channel or competitor to measure overlap",
    audienceEngaged: "Engaged audience in 30 days",
    audienceComputed: "Computed",
    audienceWorkspaceOnly: "Same workspace and platform",
    audienceChannel: "Channel",
    audienceTheirSize: "Their audience",
    audienceShareMine: "Share of yours",
    audienceShareTheirs: "Share of theirs",
    audienceAffinity: "Affinity",
    audienceHigh: "High overlap",
    audienceInsufficient: "Not enough data",
    audienceOurCalculation: "our calculation",
    audienceAllBelow: "Every row below threshold",
    audienceVenn: "Venn",
    audienceVennExplain: "Circle explanation",
    audienceVideos: "Bridge videos",
    audienceVideosLoading: "Loading videos",
    audienceNoVideos: "No video reaches privacy floor",
  }),
}));
vi.mock("../locale", () => ({ useLocale: () => "en" }));
vi.mock("../i18n", () => ({ displayDate: () => "Oct 20" }));
vi.mock("./useAudience", async (importOriginal) => ({
  // The real visibility rule, so the page test exercises it.
  audienceVisible: (await importOriginal<typeof import("./useAudience")>())
    .audienceVisible,
  useAudienceAvailability: () => ({
    isPending: false,
    isError: false,
    data: state.available,
  }),
  useAudienceChannels: () => ({
    isPending: false,
    isError: false,
    data: state.channels,
  }),
  useAudienceOverlap: () => ({
    isPending: false,
    isError: false,
    data: state.overlap,
  }),
  useSharedVideos: (...args: unknown[]) => {
    state.videosCalls.push(args);
    return { data: { status: "ready", videos: [] } };
  },
}));
import { AudiencePage } from "./AudiencePage";

afterEach(() => {
  cleanup();
  state.signedIn = true;
  state.available = { switch_on: true, plan_allows: true };
  state.pending = false;
  state.overlap.status = "ready";
  state.overlap.others = [
    {
      channel_id: "b",
      title: "B",
      handle: null,
      platform: "youtube",
      audience_size: 300,
      below_threshold: false,
      shared: 60,
      share_of_mine: 0.12,
      share_of_mine_ci: { low: 0.09, high: 0.15 },
      share_of_theirs: 0.2,
      overlap_coefficient: 0.2,
      affinity: 120,
    },
  ];
  state.channels = [{ id: "a", title: "A", platform: "youtube" }];
  state.videosCalls = [];
});
function page(path = "/audience") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AudiencePage />
    </MemoryRouter>,
  );
}

describe("AudiencePage", () => {
  it("shows the demo signed out and keeps unavailable workspaces out of the feature", () => {
    state.signedIn = false;
    const demo = page();
    expect(screen.getByText("Sign in to see overlap")).toBeInTheDocument();
    demo.unmount();
    state.signedIn = true;
    state.available = { switch_on: false, plan_allows: true };
    page();
    expect(
      screen.getByText("This section isn't available"),
    ).toBeInTheDocument();
  });
  it("also blocks plans and shows the page when both gates are open", () => {
    state.available = { switch_on: true, plan_allows: false };
    const blocked = page();
    expect(
      screen.getByText("This section isn't available"),
    ).toBeInTheDocument();
    blocked.unmount();
    state.available = { switch_on: true, plan_allows: true };
    page();
    expect(
      screen.getByRole("heading", { name: "Shared audience" }),
    ).toBeInTheDocument();
  });
  it("shows pending and no-same-platform-channel states", () => {
    state.pending = true;
    state.overlap.status = "pending";
    const pending = page();
    expect(
      screen.getByText("Measuring… first figures within 30 minutes"),
    ).toBeInTheDocument();
    pending.unmount();
    state.pending = false;
    state.overlap.status = "ready";
    state.overlap = { ...state.overlap, others: [] };
    page();
    expect(
      screen.getByText("Add a channel or competitor to measure overlap"),
    ).toBeInTheDocument();
  });
  it("announces when every other channel is below threshold", () => {
    state.overlap.status = "ready";
    state.overlap.others = [
      {
        channel_id: "b",
        title: "B",
        handle: null,
        platform: "youtube",
        audience_size: 300,
        below_threshold: true,
        shared: null,
        share_of_mine: null,
        share_of_mine_ci: null,
        share_of_theirs: null,
        overlap_coefficient: null,
        affinity: null,
      } as unknown as (typeof state.overlap.others)[number],
    ];
    page();
    expect(screen.getByText("Every row below threshold")).toBeInTheDocument();
    expect(screen.getAllByText("Not enough data").length).toBeGreaterThan(0);
  });
  it("requests ten bridge videos for the selected pair and labels the Venn totals", () => {
    page();
    expect(state.videosCalls).toContainEqual(["a", "b"]);
    expect(
      screen.getByRole("img", { name: /500, 300, 60/ }),
    ).toBeInTheDocument();
  });
});
