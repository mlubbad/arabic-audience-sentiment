// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ToastHost, toast } from "./Toast";

describe("Toast", () => {
  it("renders nothing until toast() is called", () => {
    render(<ToastHost />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a toast's title and description when toast() is called", async () => {
    render(<ToastHost />);
    act(() => {
      toast({ title: "تم التنفيذ", description: "التصنيف الجديد اعتُمد." });
    });
    expect(await screen.findByText("تم التنفيذ")).toBeVisible();
    expect(screen.getByText("التصنيف الجديد اعتُمد.")).toBeVisible();
  });

  it("two calls to toast() show two toasts, each with its own text", async () => {
    render(<ToastHost />);
    act(() => {
      toast({ title: "الأول" });
      toast({ title: "الثاني" });
    });
    await waitFor(() => {
      expect(screen.getByText("الأول")).toBeVisible();
      expect(screen.getByText("الثاني")).toBeVisible();
    });
  });
});
