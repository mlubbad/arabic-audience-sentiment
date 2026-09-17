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
  it("announces the loading sentence and shows the KPI and chart skeletons only", () => {
    render(<Loading S={ar} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(ar.loadingComments);
    const { container } = render(<Loading S={ar} />);
    // Five KPI tiles and two charts. No hero and no bar: the real ones are
    // already on screen above this, and a skeleton under each was a second
    // hero and a second bar.
    expect(container.querySelectorAll(".ui-skeleton")).toHaveLength(7);
    expect(container.querySelector(".db-sk-hero")).toBeNull();
    expect(container.querySelector(".db-sk-bar")).toBeNull();
  });

  it("shape=ops announces the operations sentence over a catalogue and two panels", () => {
    const { container } = render(
      <Loading S={ar} label={ar.opsReading} shape="ops" />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(ar.opsReading);
    expect(screen.getByRole("status")).not.toHaveTextContent(
      ar.loadingComments,
    );
    expect(container.querySelectorAll(".ui-skeleton")).toHaveLength(3);
    expect(container.querySelectorAll(".db-sk-kpi")).toHaveLength(0);
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

  it("prints the caller's sentence over the code when given one", () => {
    render(
      <LoadError
        S={ar}
        message={ar.opsReadFailed}
        failure="read:net"
        onRetry={vi.fn()}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(ar.opsReadFailed);
    expect(alert).not.toHaveTextContent(ar.loadFailed);
    expect(screen.getByTestId("failure-code")).toHaveTextContent("read:net");
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

describe("EmptyState as a page", () => {
  it("wears the caller's eyebrow, title, heading level and test id", () => {
    render(
      <MemoryRouter>
        <EmptyState
          kind="workspace"
          S={ar}
          testId="sync-signed-out"
          className="db-empty--page"
          eyebrow={ar.opsEyebrow}
          title={ar.opsTitle}
          heading="h1"
          lead={ar.opsSignedOutLead}
          links={[
            { to: "/account", label: ar.opsSignInOrJoin },
            { to: "/sync?demo=1", label: ar.opsSeeDemo },
          ]}
        />
      </MemoryRouter>,
    );
    const state = screen.getByTestId("sync-signed-out");
    expect(screen.queryByTestId("empty-state")).toBeNull();
    expect(state).toHaveClass("db-empty", "db-empty--page");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      ar.opsTitle,
    );
    expect(state).not.toHaveTextContent(ar.emptyNoCommentsTitle);
    expect(state).toHaveTextContent(ar.opsEyebrow);
    expect(state).toHaveTextContent(ar.opsSignedOutLead);
    expect(screen.getByRole("link", { name: ar.opsSeeDemo })).toHaveAttribute(
      "href",
      "/sync?demo=1",
    );
  });
});

describe("ChartEmpty", () => {
  it("renders its children with the given test id", () => {
    render(<ChartEmpty testId="chart-empty-x">لا بيانات</ChartEmpty>);
    expect(screen.getByTestId("chart-empty-x")).toHaveTextContent("لا بيانات");
  });
});
