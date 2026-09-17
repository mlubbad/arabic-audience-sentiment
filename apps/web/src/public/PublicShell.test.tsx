// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { DirectionProvider } from "@radix-ui/react-direction";
import { PublicShell } from "./PublicShell";
import { ar } from "../strings/ar";

vi.mock("../LanguageSwitch", () => ({
  LanguageSwitch: () => <a href="/en">English</a>,
}));

const links = [
  { href: "#why", label: ar.lpNavWhy, kind: "anchor" as const },
  { href: "/pricing", label: ar.pricingTitle, kind: "route" as const },
];

function Page() {
  return (
    <MemoryRouter>
      <DirectionProvider dir="rtl">
        <PublicShell
          locale="ar"
          page="home"
          links={links}
          mainId="landing-content"
        >
          <h1>محتوى</h1>
        </PublicShell>
      </DirectionProvider>
    </MemoryRouter>
  );
}

describe("PublicShell", () => {
  it("wraps the page: skip link to main, brand, nav, account CTA, footer", () => {
    render(<Page />);
    expect(
      screen.getByRole("link", { name: ar.skipToContent }),
    ).toHaveAttribute("href", "#landing-content");
    expect(screen.getByRole("main")).toContainElement(
      screen.getByText("محتوى"),
    );
    const nav = screen.getByRole("navigation", { name: ar.lpNavLabel });
    expect(
      within(nav).getByRole("link", { name: ar.lpNavWhy }),
    ).toHaveAttribute("href", "#why");
    expect(
      screen.getByRole("link", { name: new RegExp(ar.lpOpenAccount) }),
    ).toHaveAttribute("href", "/account");
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("opens the menu as a sheet, closes it on Escape and when a link is chosen", async () => {
    render(<Page />);
    const menu = screen.getByRole("button", { name: ar.lpMenuLabel });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveAttribute("data-variant", "sheet");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(menu);
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("link", {
        name: ar.lpNavWhy,
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  it("picking the same section twice from the sheet scrolls to it again", async () => {
    // `location.hash = "#why"` when the hash is already "#why" is a no-op,
    // so the second pick used to do nothing; the shell scrolls the target
    // itself in that case. jsdom has no layout and no `scrollIntoView`;
    // vitest.setup.ts supplies one on HTMLElement.prototype (not Element's,
    // where the spec puts it), and that is the one to watch.
    const scroll = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    // An earlier test's pick may have left jsdom on "#why" already.
    window.history.replaceState({}, "", "/");
    render(
      <MemoryRouter>
        <DirectionProvider dir="rtl">
          <PublicShell
            locale="ar"
            page="home"
            links={links}
            mainId="landing-content"
          >
            <h1>محتوى</h1>
            <section id="why" />
          </PublicShell>
        </DirectionProvider>
      </MemoryRouter>,
    );
    const menu = screen.getByRole("button", { name: ar.lpMenuLabel });
    const pick = async () => {
      await userEvent.click(menu);
      await userEvent.click(
        within(screen.getByRole("dialog")).getByRole("link", {
          name: ar.lpNavWhy,
        }),
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    };
    await pick();
    // The first pick went through `location.hash`, as before…
    expect(scroll).not.toHaveBeenCalled();
    // …which jsdom applies to its own URL; pinned here in case it did not,
    // so the second pick is unambiguously a repeat.
    window.history.replaceState({}, "", "#why");
    await pick();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.instances[0]).toBe(document.getElementById("why"));
    scroll.mockRestore();
    window.history.replaceState({}, "", "/");
  });

  it("does not intercept a cross-page anchor even while the sheet is open", async () => {
    // PricingPage's (and LegalPage's) own FAQ link points at the home page's
    // `#questions`, not this page's — the sheet must leave it to native
    // navigation. Regression once: the sheet swallowed the click and set
    // `location.hash` on the *current* page instead of navigating home.
    // jsdom's own location starts at "/", the same pathname the link's own
    // "/" resolves to, which would make an *uncancelled* click a same-page
    // hash update regardless of the fix under test — so this puts jsdom on
    // "/pricing" first, matching the `page="pricing"` prop, so the link
    // genuinely points elsewhere.
    window.history.pushState({}, "", "/pricing");
    render(
      <MemoryRouter>
        <DirectionProvider dir="rtl">
          <PublicShell
            locale="ar"
            page="pricing"
            links={[
              { href: "/#questions", label: ar.lpNavFaq, kind: "anchor" },
            ]}
            mainId="pricing-content"
          >
            <h1>الأسعار</h1>
          </PublicShell>
        </DirectionProvider>
      </MemoryRouter>,
    );
    const menu = screen.getByRole("button", { name: ar.lpMenuLabel });
    await userEvent.click(menu);
    let defaultPrevented: boolean | null = null;
    const onClick = (e: Event) => {
      defaultPrevented = e.defaultPrevented;
    };
    document.addEventListener("click", onClick);
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("link", {
        name: ar.lpNavFaq,
      }),
    );
    document.removeEventListener("click", onClick);
    expect(defaultPrevented).toBe(false);
    // jsdom does not implement navigating to a different pathname, so this
    // stays empty rather than becoming "#questions" — the assertion that
    // matters is defaultPrevented above: the shell did not swallow the
    // click, whatever jsdom then does or doesn't do with it.
    expect(location.hash).toBe("");
    window.history.pushState({}, "", "/");
  });
});
