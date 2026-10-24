// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { current: true },
  role: { value: "analyst" as string | null },
  channels: [
    { id: "UC1", title: "Source", subscriber_count: null, platform: "youtube" },
  ],
  candidates: [
    {
      external_id: "UC2",
      title: "Candidate",
      handle: null,
      sources: ["featured"],
      status: null,
      subscriber_count: null,
      view_count: null,
      video_count: null,
      profile_observed_at: null,
      score: null,
      tier: null,
      reasons: [] as { kind: string; value?: number }[],
    },
  ],
  limit: 3 as number | null,
  tracked: 0,
  decide: vi.fn(async (_channel: string, id: string, decision: string) => {
    if (
      decision === "tracked" &&
      mocks.limit != null &&
      mocks.tracked >= mocks.limit
    )
      throw new Error("competitor_limit_reached");
    if (decision === "dismissed")
      mocks.candidates = mocks.candidates.filter((c) => c.external_id !== id);
    if (decision === "tracked") mocks.tracked++;
    return {
      status: decision,
      tracked_count: mocks.tracked,
      limit: mocks.limit,
    };
  }),
  loadCompetitors: vi.fn(async () => ({
    channel: {
      id: "UC1",
      title: "Source",
      handle: null,
      subscriber_count: null,
      subscriber_count_hidden: null,
      country: null,
      default_language: null,
      profile_observed_at: null,
    },
    limit: mocks.limit,
    tracked_count: mocks.tracked,
    candidates: mocks.candidates,
  })),
}));
vi.mock("../session", () => ({
  useSession: () => ({
    session: mocks.session.current ? { user: { id: "user1" } } : null,
  }),
  useWorkspaces: () => ({ workspaces: [{ id: "workspace1" }] }),
}));
vi.mock("../strings", () => ({
  stringsFor: () => ({ labels: {} }),
  useStrings: () => ({
    titleCompetitors: "Competitors",
    compDemo: "Sign in and connect a channel to see competitors",
    compChoose: "Choose channel",
    compNoChannel: "No channel",
    compNoPlan: "This workspace has no active plan",
    compError: "Could not load competitors",
    compFromYoutube: "from YouTube",
    compSubscribers: "Subscribers",
    compTracked: "Tracked competitors",
    compOf: "of",
    compUnlimited: "unlimited",
    compSuggestions: "Suggestions",
    compEmpty: "No candidates",
    compFeatured: "Featured",
    compAdded: "Added",
    compStats: "Stats",
    compViews: "Views",
    compVideos: "Videos",
    compMatch: "Match",
    compEstimate: "our estimate",
    compNoScore: "Not enough data yet",
    compCollecting: "Collecting profile",
    compTrack: "Track",
    compStop: "Stop tracking",
    compDismiss: "Dismiss",
    compLimitError: "Plan limit reached",
    compLimitLead: (n: number) => `Your plan tracks up to ${n} competitors.`,
    compSeePlans: "See plans",
    compAdd: "Channel link or handle",
    compTierLabel: "Tier",
    compReasons: "Reasons",
    compExport: "Export",
    compExportSuggestionsCsv: "Suggestions (CSV)",
    compExportBenchmarkCsv: "Benchmark (CSV)",
    compExportPdf: "Report (PDF)",
    compProvenanceNote:
      "Counts are from YouTube; match scores and changes are our estimate and our calculation.",
    addDirectAvailableDesc: "Search hint",
    addChannelSearch: "Search",
    addChannelCancel: "Cancel",
  }),
}));
vi.mock("../api/competitors", () => ({
  competitorKeys: {
    all: ["competitors"],
    channel: (id: string) => ["competitors", id],
    channels: (id: string) => ["competitors", "channels", id],
    role: (id: string) => ["competitors", "role", id],
    lookup: (ws: string, input: string) => ["competitors", "lookup", ws, input],
  },
  loadChannels: async () => mocks.channels,
  loadMyRole: async () => mocks.role.value,
  loadCompetitors: () => mocks.loadCompetitors(),
  loadCompetitorBenchmark: async () => ({ days: 30, series: [] }),
  decideCompetitor: (
    ...args: [string, string, "tracked" | "dismissed" | "clear"]
  ) => mocks.decide(...args),
  lookupChannel: async () => ({ id: "UC3", title: "Resolved", handle: null }),
  addCompetitorCandidate: async () => {},
}));
import { CompetitorsPage } from "./CompetitorsPage";
import { ToastHost } from "../ui/Toast";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/competitors"]}>
        <CompetitorsPage />
      </MemoryRouter>
      {/* Outside the router, as in main.tsx. */}
      <ToastHost />
    </QueryClientProvider>,
  );
}
afterEach(cleanup);
beforeEach(() => {
  mocks.session.current = true;
  mocks.role.value = "analyst";
  mocks.channels = [
    { id: "UC1", title: "Source", subscriber_count: null, platform: "youtube" },
  ];
  mocks.candidates = [
    {
      external_id: "UC2",
      title: "Candidate",
      handle: null,
      sources: ["featured"],
      status: null,
      subscriber_count: null,
      view_count: null,
      video_count: null,
      profile_observed_at: null,
      score: null,
      tier: null,
      reasons: [],
    },
  ];
  mocks.limit = 3;
  mocks.tracked = 0;
  mocks.decide.mockClear();
  mocks.loadCompetitors.mockClear();
});
describe("CompetitorsPage", () => {
  it("renders null channel counts as unknown without crashing", async () => {
    renderPage();
    await screen.findByRole("link", { name: "Candidate" });
    expect(screen.getByText(/from YouTube: Subscribers —/)).toBeInTheDocument();
  });
  it("renders a null score, unlimited plan and unknown reason safely", async () => {
    mocks.limit = null;
    mocks.candidates[0]!.reasons = [{ kind: "future_reason" }];
    renderPage();
    expect(await screen.findByText(/Not enough data yet/)).toBeInTheDocument();
    expect(screen.getAllByText(/unlimited/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Candidate" })).toBeInTheDocument();
  });
  it("shows the plan limit with a pricing link and leaves a candidate untracked", async () => {
    mocks.tracked = 3;
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Track" }));
    expect(
      await screen.findByRole("link", { name: "See plans" }),
    ).toHaveAttribute("href", "/pricing");
    expect(mocks.candidates[0]?.status).toBeNull();
    expect(screen.getByRole("button", { name: "Track" })).toBeInTheDocument();
  });
  it("removes a dismissed candidate after refetch", async () => {
    renderPage();
    await userEvent.click(
      await screen.findByRole("button", { name: "Dismiss" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Candidate")).not.toBeInTheDocument(),
    );
    expect(mocks.loadCompetitors).toHaveBeenCalledTimes(2);
  });
  it("hides actions from viewers", async () => {
    mocks.role.value = "viewer";
    renderPage();
    await screen.findByRole("link", { name: "Candidate" });
    expect(
      screen.queryByRole("button", { name: "Track" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Dismiss" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });
  it("opens the Export menu and calls window.print for PDF export", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    renderPage();
    await screen.findByRole("link", { name: "Candidate" });
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(
      await screen.findByRole("menuitem", { name: "Suggestions (CSV)" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Report (PDF)" }),
    );
    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });
  it("shows the no active plan state", async () => {
    mocks.loadCompetitors.mockRejectedValueOnce(new Error("no_active_plan"));
    renderPage();
    expect(await screen.findByText(/no active plan/i)).toBeInTheDocument();
  });
  it("shows demo empty state in the fixture shell", async () => {
    mocks.session.current = false;
    renderPage();
    expect(
      await screen.findByText(/Sign in and connect a channel/),
    ).toBeInTheDocument();
  });
});
