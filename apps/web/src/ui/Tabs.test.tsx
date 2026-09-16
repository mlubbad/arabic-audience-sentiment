// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DirectionProvider } from "@radix-ui/react-direction";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

function ExampleTabs() {
  return (
    <Tabs defaultValue="individual">
      <TabsList aria-label="نوع الحساب">
        <TabsTrigger value="individual">فردي</TabsTrigger>
        <TabsTrigger value="business">أعمال</TabsTrigger>
      </TabsList>
      <TabsContent value="individual">أسعار الفردي</TabsContent>
      <TabsContent value="business">أسعار الأعمال</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("shows the default tab's panel and switches on click", async () => {
    render(<ExampleTabs />);
    expect(screen.getByText("أسعار الفردي")).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "أعمال" }));
    expect(screen.getByText("أسعار الأعمال")).toBeVisible();
  });

  it("in LTR (the default), ArrowRight from the first tab moves to the next", async () => {
    render(<ExampleTabs />);
    screen.getByRole("tab", { name: "فردي" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "أعمال" })).toHaveFocus();
  });

  it("under Direction=rtl, ArrowLeft — not ArrowRight — moves to the next tab", async () => {
    render(
      <DirectionProvider dir="rtl">
        <ExampleTabs />
      </DirectionProvider>,
    );
    screen.getByRole("tab", { name: "فردي" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    // The LTR key does nothing in RTL: focus stays put.
    expect(screen.getByRole("tab", { name: "فردي" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "أعمال" })).toHaveFocus();
  });
});
