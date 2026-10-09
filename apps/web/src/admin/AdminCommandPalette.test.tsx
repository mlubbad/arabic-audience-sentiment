// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { AdminChannel, AdminUser } from "@sentiment/contracts";
import { ar } from "../strings/ar";
import {
  AdminCommandPalette,
  fold,
  matchItems,
  type PaletteItem,
} from "./AdminCommandPalette";
import * as adminRead from "./adminRead";

vi.mock("./adminRead");

const WS = "00000000-0000-4000-8000-000000000003";
const CHANNELS: AdminChannel[] = [
  {
    id: "10000000-0000-4000-8000-000000000003",
    workspace_id: WS,
    workspace_name: "بشار عربي – bashar arabi",
    external_channel_id: "UCAAAAAAAAAAAAAAAAAAAAA3",
    handle: "@BasharIbnArabi",
    title: "بشار عربي – bashar arabi",
    status: "public_unverified",
    video_count: 10,
    comment_count: 100,
    last_sync_at: null,
    last_sync_status: null,
    last_sync_error: null,
    last_collect_ok_at: null,
  },
];
const USERS: AdminUser[] = [
  {
    id: "10000000-0000-4000-8000-000000000009",
    email: "customer@example.com",
    created_at: "2026-08-14T10:00:00+00:00",
    last_sign_in_at: null,
    workspace_count: 1,
    owner_count: 1,
  },
];

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <AdminCommandPalette />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("matchItems", () => {
  const items: PaletteItem[] = [
    { group: "pages", label: "الرئيسية", to: "/admin" },
    { group: "channels", label: "أنور المحبوب", detail: "@aano637", to: "/a" },
    { group: "channels", label: "Noor Stars", detail: "@noorstars", to: "/b" },
  ];

  it("folds the Arabic letter forms people type interchangeably", () => {
    expect(fold("أنور")).toBe(fold("انور"));
    expect(fold("مُصطفى")).toBe(fold("مصطفي"));
  });

  it("matches every word in the name or the handle, and offers the pages before anything is typed", () => {
    expect(matchItems(items, "").map((i) => i.to)).toEqual(["/admin"]);
    expect(matchItems(items, "انور").map((i) => i.to)).toEqual(["/a"]);
    expect(matchItems(items, "noor STARS").map((i) => i.to)).toEqual(["/b"]);
    expect(matchItems(items, "noorstars").map((i) => i.to)).toEqual(["/b"]);
    expect(matchItems(items, "nothing")).toEqual([]);
  });
});

describe("AdminCommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminRead.readAdminChannels).mockResolvedValue(CHANNELS);
    vi.mocked(adminRead.readAdminUsers).mockResolvedValue(USERS);
  });

  it("reads nothing until it is opened", () => {
    mount();
    expect(adminRead.readAdminChannels).not.toHaveBeenCalled();
  });

  it("opens on Ctrl+K and takes a channel to its workspace's dashboard", async () => {
    mount();
    await userEvent.keyboard("{Control>}k{/Control}");
    const box = await screen.findByRole("combobox", {
      name: ar.adminSearchTitle,
    });
    await userEvent.type(box, "bashar");
    // The lists arrive after the box opens; the channel shows once they do.
    await screen.findByText("@BasharIbnArabi · بشار عربي – bashar arabi");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByTestId("where")).toHaveTextContent(
      `/dashboard?ws=${WS}`,
    );
  });

  it("takes an account to its file", async () => {
    mount();
    await userEvent.click(screen.getByTestId("admin-search-open"));
    const box = await screen.findByRole("combobox", {
      name: ar.adminSearchTitle,
    });
    await userEvent.type(box, "customer");
    await userEvent.click(await screen.findByText("customer@example.com"));
    expect(screen.getByTestId("where")).toHaveTextContent(
      `/admin/users?u=${USERS[0]!.id}`,
    );
  });
});
