// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ar } from "../strings/ar";
import type { JobEntry, JobRow } from "../jobFeed";
import { Attempts } from "./Attempts";

const sampleEntry = (over: Partial<JobEntry> = {}): JobEntry => ({
  id: "entry-1",
  type: "collect",
  status: "succeeded",
  severity: "ok",
  headline: "مهمة جمع تعليقات",
  detail: "اكتملت 10 تعليقات",
  createdAt: "2026-09-15T00:00:00Z",
  attempt: 0,
  cancellable: false,
  retryable: false,
  ...over,
});

const sampleJob = (over: Partial<JobRow> = {}): JobRow => ({
  id: "job-1",
  type: "collect",
  status: "succeeded",
  attempt: 0,
  error_code: null,
  created_at: "2026-09-15T00:00:00Z",
  ...over,
});

describe("Attempts component", () => {
  it("renders empty state when there are no entries", () => {
    render(
      <Attempts
        mode="live"
        jobsFailed={false}
        jobs={[]}
        entries={[]}
        lang="ar"
        acting={null}
        actionMessage=""
        act={() => {}}
        refresh={() => {}}
        S={ar}
      />,
    );
    expect(screen.getByText(ar.opsNoAttemptsStrong)).toBeInTheDocument();
  });

  it("renders summary counters and filters entries by status", async () => {
    const user = userEvent.setup();
    const entries: JobEntry[] = [
      sampleEntry({
        id: "e1",
        status: "running",
        severity: "warning",
        headline: "Running Job",
      }),
      sampleEntry({
        id: "e2",
        status: "succeeded",
        severity: "ok",
        headline: "Succeeded Job",
      }),
      sampleEntry({
        id: "e3",
        status: "failed",
        severity: "critical",
        headline: "Failed Job",
      }),
    ];

    render(
      <Attempts
        mode="live"
        jobsFailed={false}
        jobs={[sampleJob()]}
        entries={entries}
        lang="ar"
        acting={null}
        actionMessage=""
        act={() => {}}
        refresh={() => {}}
        S={ar}
      />,
    );

    // Initial state: "all" filter, all 3 items visible
    expect(screen.getByText("Running Job")).toBeInTheDocument();
    expect(screen.getByText("Succeeded Job")).toBeInTheDocument();
    expect(screen.getByText("Failed Job")).toBeInTheDocument();

    // Filter to Running only
    const runningTab = screen.getByRole("tab", {
      name: new RegExp(ar.opsAttemptsFilterRunning),
    });
    await user.click(runningTab);

    expect(screen.getByText("Running Job")).toBeInTheDocument();
    expect(screen.queryByText("Succeeded Job")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed Job")).not.toBeInTheDocument();

    // Filter to Needs Attention only
    const failedTab = screen.getByRole("tab", {
      name: new RegExp(ar.opsAttemptsFilterFailed),
    });
    await user.click(failedTab);

    expect(screen.queryByText("Running Job")).not.toBeInTheDocument();
    expect(screen.queryByText("Succeeded Job")).not.toBeInTheDocument();
    expect(screen.getByText("Failed Job")).toBeInTheDocument();
  });

  it("paginates entries when there are more than 8 entries", async () => {
    const user = userEvent.setup();
    const entries: JobEntry[] = Array.from({ length: 12 }, (_, i) =>
      sampleEntry({
        id: `e-${i + 1}`,
        headline: `Job Number ${i + 1}`,
      }),
    );

    render(
      <Attempts
        mode="live"
        jobsFailed={false}
        jobs={[sampleJob()]}
        entries={entries}
        lang="ar"
        acting={null}
        actionMessage=""
        act={() => {}}
        refresh={() => {}}
        S={ar}
      />,
    );

    // Page 1 should show Job 1 to 8, but not Job 9
    expect(screen.getByText("Job Number 1")).toBeInTheDocument();
    expect(screen.getByText("Job Number 8")).toBeInTheDocument();
    expect(screen.queryByText("Job Number 9")).not.toBeInTheDocument();

    // Pager indicates Page 1 of 2
    expect(screen.getByText(ar.opsAttemptsPageOf(1, 2))).toBeInTheDocument();

    // Click Next page
    const nextBtn = screen.getByText(ar.nextPage);
    await user.click(nextBtn);

    // Page 2 should show Job 9 to 12
    expect(screen.queryByText("Job Number 1")).not.toBeInTheDocument();
    expect(screen.getByText("Job Number 9")).toBeInTheDocument();
    expect(screen.getByText("Job Number 12")).toBeInTheDocument();
    expect(screen.getByText(ar.opsAttemptsPageOf(2, 2))).toBeInTheDocument();
  });

  it("triggers cancel and retry callbacks", async () => {
    const user = userEvent.setup();
    const onAct = vi.fn();
    const entries: JobEntry[] = [
      sampleEntry({
        id: "e-cancel",
        status: "queued",
        cancellable: true,
      }),
      sampleEntry({
        id: "e-retry",
        status: "failed",
        retryable: true,
      }),
    ];

    render(
      <Attempts
        mode="live"
        jobsFailed={false}
        jobs={[sampleJob()]}
        entries={entries}
        lang="ar"
        acting={null}
        actionMessage=""
        act={onAct}
        refresh={() => {}}
        S={ar}
      />,
    );

    const cancelBtn = screen.getByTestId("cancel-e-cancel");
    await user.click(cancelBtn);
    expect(onAct).toHaveBeenCalledWith("cancel_job", "e-cancel");

    const retryBtn = screen.getByTestId("retry-e-retry");
    await user.click(retryBtn);
    expect(onAct).toHaveBeenCalledWith("retry_job", "e-retry");
  });

  it("renders elapsed duration and expected completion time for queued, running, and completed jobs", () => {
    const entries: JobEntry[] = [
      sampleEntry({
        id: "e-queued",
        type: "discover",
        status: "queued",
        headline: "فهرسة القناة",
      }),
      sampleEntry({
        id: "e-running",
        type: "collect",
        status: "running",
        headline: "جمع التعليقات",
      }),
      sampleEntry({
        id: "e-succeeded",
        type: "analyse",
        status: "succeeded",
        headline: "تحليل المشاعر",
        durationSeconds: 42,
      }),
    ];

    render(
      <Attempts
        mode="live"
        jobsFailed={false}
        jobs={[sampleJob()]}
        entries={entries}
        lang="ar"
        acting={null}
        actionMessage=""
        act={() => {}}
        refresh={() => {}}
        S={ar}
      />,
    );

    // Queued job shows waiting time and expected completion
    expect(screen.getByText(/في الانتظار منذ/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(ar.opsEstimatedTimeDiscover)),
    ).toBeInTheDocument();

    // Running job shows running time and expected completion
    expect(screen.getByText(/مستمرة منذ/)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(ar.opsEstimatedTimeCollect)),
    ).toBeInTheDocument();

    // Succeeded job shows duration
    expect(screen.getByText(/استغرقت 42 ثانية/)).toBeInTheDocument();
  });
});
