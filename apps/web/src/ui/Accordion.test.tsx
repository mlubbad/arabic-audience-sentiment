// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./Accordion";

function Faq() {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="one">
        <AccordionTrigger>سؤال أول</AccordionTrigger>
        <AccordionContent>جواب أول</AccordionContent>
      </AccordionItem>
      <AccordionItem value="two">
        <AccordionTrigger>سؤال ثانٍ</AccordionTrigger>
        <AccordionContent>جواب ثانٍ</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

describe("Accordion", () => {
  it("starts closed and opens on click, with the state on the trigger", async () => {
    render(<Faq />);
    const first = screen.getByRole("button", { name: "سؤال أول" });
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("جواب أول")).not.toBeInTheDocument();
    await userEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("جواب أول")).toBeVisible();
    await userEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "false");
  });

  it("puts each question in a level-3 heading, so the FAQ keeps its outline", () => {
    render(<Faq />);
    expect(
      screen.getByRole("heading", { level: 3, name: "سؤال أول" }),
    ).toBeInTheDocument();
  });

  it("moves between questions with the arrow keys and opens with Enter", async () => {
    render(<Faq />);
    screen.getByRole("button", { name: "سؤال أول" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    const second = screen.getByRole("button", { name: "سؤال ثانٍ" });
    expect(second).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("جواب ثانٍ")).toBeVisible();
  });
});
