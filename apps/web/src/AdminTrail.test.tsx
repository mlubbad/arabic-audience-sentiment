// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ar } from "./strings/ar";
import { AdminTrail } from "./AdminTrail";
import { saveTrail } from "./admin/adminTrail";
import * as adminAccess from "./adminAccess";
import * as impersonation from "./impersonation";

vi.mock("./session", () => ({
  useSession: () => ({ session: { user: { id: "owner" } } }),
}));

const TRAIL = {
  back: "/admin/channels?state=failing",
  items: [
    { workspace_id: "w1", name: "One" },
    { workspace_id: "w2", name: "Two" },
    { workspace_id: "w3", name: "Three" },
  ],
};

function admin(is: boolean, impersonating = false) {
  vi.spyOn(adminAccess, "useIsPlatformAdmin").mockReturnValue({
    data: is,
  } as unknown as ReturnType<typeof adminAccess.useIsPlatformAdmin>);
  vi.spyOn(impersonation, "useImpersonation").mockReturnValue({
    isImpersonating: impersonating,
  } as unknown as ReturnType<typeof impersonation.useImpersonation>);
}

const mount = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AdminTrail />
    </MemoryRouter>,
  );

describe("AdminTrail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    saveTrail(TRAIL);
    admin(true);
  });

  it("names the channel, leads back to the console as it was, and on to the neighbours on the same page", () => {
    mount("/sync?ws=w2&demo=1");
    const nav = screen.getByTestId("admin-trail");
    expect(nav).toHaveTextContent("Two");
    expect(nav).toHaveTextContent(ar.adminConsolePosition(2, 3));
    expect(
      screen.getByRole("link", { name: ar.adminTabChannels }),
    ).toHaveAttribute("href", TRAIL.back);
    expect(
      screen.getByRole("link", { name: `${ar.adminConsolePrev}: One` }),
    ).toHaveAttribute("href", "/sync?ws=w1&demo=1");
    expect(
      screen.getByRole("link", { name: `${ar.adminConsoleNext}: Three` }),
    ).toHaveAttribute("href", "/sync?ws=w3&demo=1");
  });

  it("offers no step past either end", () => {
    mount("/dashboard?ws=w3");
    expect(screen.queryByRole("link", { name: /Three|التالية/ })).toBeNull();
    expect(
      screen.getByRole("link", { name: `${ar.adminConsolePrev}: Two` }),
    ).toBeInTheDocument();
  });

  it("shows nothing outside the list, off a workspace page, to a non-admin or while impersonating", () => {
    const empty = (path: string) => {
      const { container, unmount } = mount(path);
      expect(container).toBeEmptyDOMElement();
      unmount();
    };
    empty("/dashboard?ws=w9");
    empty("/account?ws=w2");
    admin(false);
    empty("/dashboard?ws=w2");
    admin(true, true);
    empty("/dashboard?ws=w2");
  });

  it("is put away, and forgotten, by its close button", async () => {
    mount("/dashboard?ws=w2");
    await userEvent.click(
      screen.getByRole("button", { name: ar.adminTrailClose }),
    );
    expect(screen.queryByTestId("admin-trail")).toBeNull();
    expect(window.sessionStorage.getItem("admin-trail:v1")).toBeNull();
  });
});
