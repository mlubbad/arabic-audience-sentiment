// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { AdminChannel } from "@sentiment/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLocale, setLocale } from "../locale";
import { ar } from "../strings/ar";
import { en } from "../strings/en";
import { loadStrings } from "../strings";
import * as adminReadModule from "./adminRead";
import * as adminShellModule from "./AdminShell";
import { AdminChannelsPage } from "./AdminChannelsPage";

vi.mock("./adminRead");
vi.mock("./AdminShell", async (importOriginal) => {
  const actual = await importOriginal<typeof adminShellModule>();
  return {
    ...actual,
    useAdminShell: () => ({
      admin: true,
      shell: (children: React.ReactNode) => <div>{children}</div>,
    }),
  };
});

const base: AdminChannel = {
  id: "30000000-0000-4000-8000-000000000001",
  workspace_id: "20000000-0000-4000-8000-000000000001",
  workspace_name: "Workspace",
  external_channel_id: "UC1",
  handle: null,
  title: "49 hours",
  status: "connected",
  video_count: 1,
  comment_count: 2,
  last_sync_at: null,
  last_sync_status: null,
  last_sync_error: null,
  last_collect_ok_at: "2026-10-04T11:00:00Z",
};

const channels: AdminChannel[] = [
  base,
  {
    ...base,
    id: "30000000-0000-4000-8000-000000000002",
    external_channel_id: "UC2",
    title: "47 hours",
    last_collect_ok_at: "2026-10-04T13:00:00Z",
  },
  {
    ...base,
    id: "30000000-0000-4000-8000-000000000003",
    external_channel_id: "UC3",
    title: "No collection",
    last_collect_ok_at: null,
  },
  {
    ...base,
    id: "30000000-0000-4000-8000-000000000004",
    external_channel_id: "UC4",
    title: "Disconnected",
    status: "disconnected",
    last_collect_ok_at: "2026-10-01T12:00:00Z",
  },
];

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminChannelsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminChannelsPage collection freshness", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    vi.spyOn(adminReadModule, "readAdminChannels").mockResolvedValue(channels);
    resetLocale();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetLocale();
  });

  it("warns connected channels beyond 48 hours or without a successful collection", async () => {
    mount();
    const table = await screen.findByTestId("admin-channels");
    const rows = within(table).getAllByRole("row");

    expect(within(rows[1]).getByText("2 d")).toHaveAttribute(
      "title",
      "2026-10-04T11:00:00Z",
    );
    expect(
      within(rows[1]).getByText(ar.adminChannelsCollectionStale),
    ).toBeInTheDocument();
    expect(within(rows[2]).getByText("47 h")).toBeInTheDocument();
    expect(
      within(rows[2]).queryByText(ar.adminChannelsCollectionStale),
    ).toBeNull();
    expect(
      within(rows[3]).getByText(ar.adminChannelsCollectionStale),
    ).toBeInTheDocument();
    expect(
      within(rows[4]).queryByText(ar.adminChannelsCollectionStale),
    ).toBeNull();
  });

  it("renders the new column label in Arabic and English", async () => {
    const first = mount();
    expect(
      await screen.findByText(ar.adminChannelsLastSuccessfulCollection),
    ).toBeInTheDocument();
    first.unmount();

    await loadStrings("en");
    setLocale("en");
    mount();
    expect(
      await screen.findByText(en.adminChannelsLastSuccessfulCollection),
    ).toBeInTheDocument();
  });
});
