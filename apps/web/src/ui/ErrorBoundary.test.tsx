// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function ProblemChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Simulated rendering explosion");
  }
  return <div>Safe child content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Safe child content")).toBeInTheDocument();
  });

  it("catches errors and renders fallback UI instead of crashing", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.queryByText("Safe child content")).not.toBeInTheDocument();
    expect(screen.getByText("حدث خطأ أثناء تحميل الصفحة")).toBeInTheDocument();
    expect(
      screen.getByText("Simulated rendering explosion"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "إعادة تحميل الصفحة" }),
    ).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it("shows exit impersonation button when impersonating", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionStorage.setItem(
      "sentiment_impersonation_session",
      JSON.stringify({ id: "user-123", email: "test@example.com" }),
    );

    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(
      screen.getByRole("button", {
        name: "إنهاء المحاكاة والعودة لحساب المدير",
      }),
    ).toBeInTheDocument();

    sessionStorage.removeItem("sentiment_impersonation_session");
    consoleSpy.mockRestore();
  });
});
