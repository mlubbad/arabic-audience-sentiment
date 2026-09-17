// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { Faq } from "./Faq";
import { Closing } from "./Closing";
import { ar } from "../strings/ar";

describe("Faq", () => {
  it("lists every question as a level-3 heading in the strings' order and opens one", async () => {
    const { container } = render(<Faq locale="ar" />);
    expect(container.querySelector("section#questions")).toHaveAttribute(
      "aria-labelledby",
      "faq-title",
    );
    const questions = ar.lpFaq.filter((_, i) => i % 2 === 0);
    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent?.trim());
    expect(headings).toEqual(questions);
    await userEvent.click(screen.getByRole("button", { name: questions[0] }));
    expect(screen.getByText(ar.lpFaq[1])).toBeVisible();
  });
});

describe("Closing", () => {
  it("carries the last call to action to the dashboard", () => {
    render(
      <MemoryRouter>
        <Closing locale="ar" />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", { name: new RegExp(ar.lpExploreDashboard) }),
    ).toHaveAttribute("href", "/dashboard");
  });
});
