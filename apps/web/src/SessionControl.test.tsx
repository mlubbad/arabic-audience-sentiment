// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ar } from "./strings/ar";

const shared = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email?: string } },
  loading: false,
  signOut: vi.fn<() => Promise<{ error: { message: string } | null }>>(),
}));

vi.mock("./session", () => ({
  useSession: () => ({ session: shared.session, loading: shared.loading }),
}));
vi.mock("./supabase", () => ({
  supabase: { auth: { signOut: () => shared.signOut() } },
}));

import { SessionControl } from "./SessionControl";

const renderControl = () =>
  render(
    <MemoryRouter>
      <SessionControl />
    </MemoryRouter>,
  );

beforeEach(() => {
  shared.session = { user: { id: "owner", email: "owner@example.com" } };
  shared.loading = false;
  shared.signOut.mockReset();
  shared.signOut.mockResolvedValue({ error: null });
});

describe("SessionControl", () => {
  it("renders nothing while the session is still loading", () => {
    shared.loading = true;
    const { container } = renderControl();
    expect(container).toBeEmptyDOMElement();
  });

  it("signed out, is a sign-in link to the account page", () => {
    shared.session = null;
    renderControl();
    expect(screen.getByRole("link", { name: ar.signIn })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("signed in, the email is the menu trigger and the menu is closed until it is pressed", async () => {
    renderControl();
    const trigger = screen.getByRole("button", { name: /owner@example\.com/ });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await userEvent.click(trigger);
    expect(await screen.findByRole("menu")).toBeVisible();
  });

  it("the menu offers the account page as a real link", async () => {
    renderControl();
    await userEvent.click(
      screen.getByRole("button", { name: /owner@example\.com/ }),
    );
    const item = await screen.findByRole("menuitem", { name: ar.yourAccount });
    expect(item).toHaveAttribute("href", "/account");
  });

  it("falls back to the account label when the provider gave no email", async () => {
    shared.session = { user: { id: "owner" } };
    renderControl();
    // The "▾" beside the label is aria-hidden, so the accessible name is the
    // label alone; a regex keeps this true even if that glyph ever changes.
    expect(
      screen.getByRole("button", { name: new RegExp(ar.yourAccount) }),
    ).toBeInTheDocument();
  });

  it("sign out calls through to Supabase, and a failure is said, not swallowed", async () => {
    shared.signOut.mockResolvedValue({ error: { message: "network" } });
    renderControl();
    await userEvent.click(
      screen.getByRole("button", { name: /owner@example\.com/ }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: ar.signOut }),
    );
    expect(shared.signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      ar.signOutFailed,
    );
  });

  it("a clean sign out raises no alert", async () => {
    renderControl();
    await userEvent.click(
      screen.getByRole("button", { name: /owner@example\.com/ }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: ar.signOut }),
    );
    await waitFor(() => expect(shared.signOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
