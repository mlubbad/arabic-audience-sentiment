// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { AdminCompareChannel } from "@sentiment/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ar } from "../strings/ar";
import * as adminRead from "./adminRead";
import { AdminComparePage } from "./AdminComparePage";
import { MIN_SAMPLE } from "./compareChannels";

vi.mock("./adminRead");
vi.mock("./AdminShell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./AdminShell")>();
  return {
    ...actual,
    AdminPageHead: ({ title }: { title: string }) => <h1>{title}</h1>,
    useAdminShell: () => ({
      admin: true,
      shell: (children: React.ReactNode) => <div>{children}</div>,
    }),
  };
});

const zero = { analysed: 0, positive: 0, negative: 0 };
const row = (
  i: number,
  over: Partial<AdminCompareChannel>,
): AdminCompareChannel => ({
  id: `10000000-0000-4000-8000-00000000000${i}`,
  workspace_id: `00000000-0000-4000-8000-00000000000${i}`,
  workspace_name: `ws ${i}`,
  mine: true,
  owner_email: "owner@example.com",
  platform: "youtube",
  external_channel_id: `UCAAAAAAAAAAAAAAAAAAAAA${i}`,
  title: `Channel ${i}`,
  handle: null,
  copies: 1,
  analysed: 100,
  positive: 0,
  negative: 0,
  neutral: 0,
  mixed: 0,
  week: zero,
  previous_week: zero,
  top_topic: null,
  refreshed_at: "2026-10-09T12:00:00+00:00",
  count_state: "current",
  count_error: null,
  next_attempt_at: null,
  ...over,
});
const ROWS = [
  row(1, {
    title: "Warm",
    positive: 90,
    negative: 10,
    top_topic: {
      key: "praise",
      name_ar: "مديح",
      name_en: "Praise",
      comments: 40,
    },
  }),
  row(2, {
    title: "Cold",
    positive: 20,
    negative: 60,
    copies: 2,
    week: { analysed: 40, positive: 5, negative: 30 },
    previous_week: { analysed: 40, positive: 20, negative: 20 },
  }),
  row(3, {
    title: "Tiny",
    positive: 2,
    negative: 1,
    refreshed_at: "2026-10-08T06:30:00+00:00",
  }),
  // Never counted, and one whose count keeps failing (20261025000000).
  row(4, {
    title: "Fresh",
    analysed: 0,
    refreshed_at: null,
    count_state: "never",
  }),
  row(5, {
    title: "Stuck",
    analysed: 0,
    refreshed_at: null,
    count_state: "failing",
    count_error: "ERROR:  canceling statement due to statement timeout",
    next_attempt_at: "2026-10-13T03:10:00+00:00",
  }),
];

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

function mount(path = "/admin/compare") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <AdminComparePage />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const names = () =>
  within(screen.getByTestId("admin-compare"))
    .getAllByRole("link")
    .map((a) => a.textContent);

describe("AdminComparePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminRead.readAdminChannelsCompare).mockResolvedValue(ROWS);
  });

  it("ranks the warmest first, with its net, topic and the cards above", async () => {
    mount();
    await screen.findByTestId("admin-compare");
    expect(names()).toEqual(["Warm", "Cold", "Tiny", "Fresh", "Stuck"]);
    const warm = screen.getByTestId(`admin-compare-row-${ROWS[0]!.id}`);
    expect(warm).toHaveTextContent("1");
    expect(warm).toHaveTextContent(ar.adminComparePercent(80));
    expect(warm).toHaveTextContent("مديح");

    const cards = screen.getByTestId("admin-compare-cards");
    expect(
      within(cards).getByText(ar.adminCompareBest).parentElement,
    ).toHaveTextContent("Warm");
    expect(
      within(cards).getByText(ar.adminCompareWorst).parentElement,
    ).toHaveTextContent("Cold");
    // Cold went from 0 to −71.4 this week.
    expect(
      within(cards).getByText(ar.adminCompareMover).parentElement,
    ).toHaveTextContent(ar.adminComparePoints(-71.4));
  });

  it("marks a small sample instead of ranking it, and says how many are not counted yet", async () => {
    mount();
    const tiny = await screen.findByTestId(`admin-compare-row-${ROWS[2]!.id}`);
    expect(tiny).toHaveTextContent(ar.adminCompareSmall);
    expect(
      screen.getByText(ar.adminCompareHow(MIN_SAMPLE), { exact: false }),
    ).toBeVisible();
    expect(
      screen.getByText(new RegExp(ar.adminCompareNotCounted(1))),
    ).toBeVisible();
    expect(
      screen.getByText(new RegExp(ar.adminCompareFailingCount(1))),
    ).toBeVisible();
    expect(
      screen.getByTestId(`admin-compare-row-${ROWS[1]!.id}`),
    ).toHaveTextContent(ar.adminCompareCopies(2));
  });

  it("keeps the order in the address, and links a channel to the channels page", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId("admin-compare");
    await user.selectOptions(
      screen.getByLabelText(ar.adminConsoleSortLabel),
      "worst",
    );
    expect(screen.getByTestId("where")).toHaveTextContent(
      "/admin/compare?sort=worst",
    );
    expect(names()).toEqual(["Cold", "Warm", "Tiny", "Fresh", "Stuck"]);
    expect(
      within(screen.getByTestId("admin-compare")).getByRole("link", {
        name: ar.adminCompareOpen("Cold"),
      }),
    ).toHaveAttribute(
      "href",
      `/admin/channels?q=${ROWS[1]!.external_channel_id}`,
    );
  });

  it("shows a never-counted channel and a failing count as such, not as a small sample", async () => {
    mount();
    const fresh = await screen.findByTestId(`admin-compare-row-${ROWS[3]!.id}`);
    expect(fresh).toHaveTextContent(ar.adminCompareStateNever);
    expect(fresh).not.toHaveTextContent(ar.adminCompareSmall);
    const stuck = screen.getByTestId(`admin-compare-failing-${ROWS[4]!.id}`);
    expect(stuck).toHaveTextContent(ar.adminCompareStateFailing);
    expect(stuck).toHaveAttribute(
      "title",
      ar.adminCompareFailingTitle(
        "ERROR:  canceling statement due to statement timeout",
        "2026-10-13 03:10",
      ),
    );
    // The freshness line names the oldest count, not the newest.
    expect(
      screen.getByText(ar.adminCompareRefreshed("2026-10-08 06:30"), {
        exact: false,
      }),
    ).toBeVisible();
  });
});
