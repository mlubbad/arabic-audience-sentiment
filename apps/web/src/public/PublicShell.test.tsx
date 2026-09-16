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
});
