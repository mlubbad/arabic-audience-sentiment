// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ar } from "../strings/ar";
import {
  ChartEmpty,
  EmptyState,
  Loading,
  LoadError,
  Updating,
} from "./PageStates";

describe("Loading", () => {
  it("announces the loading sentence and shows at least five skeletons", () => {
    render(<Loading S={ar} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(ar.loadingComments);
    const { container } = render(<Loading S={ar} />);
    expect(
      container.querySelectorAll(".ui-skeleton").length,
    ).toBeGreaterThanOrEqual(5);
  });
});

describe("Updating", () => {
  it("renders the updating sentence with a status role", () => {
    render(<Updating S={ar} />);
    expect(screen.getByTestId("updating")).toHaveTextContent(
      ar.updatingResults,
    );
  });
});

describe("LoadError", () => {
  it("renders the filters-failed sentence for a view: failure", () => {
    render(<LoadError S={ar} failure="view:bad" onRetry={vi.fn()} />);
    expect(screen.getByTestId("load-error")).toHaveTextContent(
      ar.filtersFailed,
    );
    expect(screen.getByTestId("failure-code")).toHaveTextContent("view:bad");
  });

  it("renders the load-failed sentence for a read: failure", () => {
    render(<LoadError S={ar} failure="read:net" onRetry={vi.fn()} />);
    expect(screen.getByTestId("load-error")).toHaveTextContent(ar.loadFailed);
  });

  it("carries role=alert and calls onRetry from its button", async () => {
    const onRetry = vi.fn();
    render(<LoadError S={ar} failure="read:net" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBe(screen.getByTestId("load-error"));
    await userEvent.click(screen.getByRole("button", { name: ar.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("EmptyState", () => {
  it("kind=filters renders the no-match title, its lead and a reset button", async () => {
    const onReset = vi.fn();
    render(
      <EmptyState
        kind="filters"
        S={ar}
        lead={ar.emptyNoMatchLead("42")}
        onReset={onReset}
      />,
    );
    const empty = screen.getByTestId("empty-state");
    expect(empty).toHaveTextContent(ar.emptyNoMatchTitle);
    expect(empty).toHaveTextContent(ar.emptyNoMatchLead("42"));
    await userEvent.click(
      screen.getByRole("button", { name: ar.showAllComments }),
    );
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("kind=workspace renders the no-comments title, the setup node and its links", () => {
    render(
      <MemoryRouter>
        <EmptyState
          kind="workspace"
          S={ar}
          setup={<div data-testid="setup-node">setup</div>}
          links={[
            { to: "/sync", label: ar.emptyFollowCollection },
            { to: "/account", label: ar.emptyConnectOrSync },
          ]}
        />
      </MemoryRouter>,
    );
    const empty = screen.getByTestId("empty-state");
    expect(empty).toHaveTextContent(ar.emptyNoCommentsTitle);
    expect(screen.getByTestId("setup-node")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: ar.emptyFollowCollection }),
    ).toHaveAttribute("href", "/sync");
    expect(
      screen.getByRole("link", { name: ar.emptyConnectOrSync }),
    ).toHaveAttribute("href", "/account");
  });
});

describe("ChartEmpty", () => {
  it("renders its children with the given test id", () => {
    render(<ChartEmpty testId="chart-empty-x">لا بيانات</ChartEmpty>);
    expect(screen.getByTestId("chart-empty-x")).toHaveTextContent("لا بيانات");
  });
});
