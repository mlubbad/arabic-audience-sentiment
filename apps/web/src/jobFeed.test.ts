import { describe, expect, it } from "vitest";
import { describeJob, type JobRow } from "./jobFeed";

const row = (over: Partial<JobRow> = {}): JobRow => ({
  id: "j1",
  status: "queued",
  attempt: 0,
  error_code: null,
  created_at: "2026-09-14T02:00:00Z",
  ...over,
});

describe("describeJob", () => {
  it("separates waiting-with-a-worker from waiting-with-none", () => {
    const withWorker = describeJob(row(), { workerConnected: true });
    const without = describeJob(row(), { workerConnected: false });
    expect(withWorker.severity).toBe("warning");
    expect(without.severity).toBe("critical");
    // The second says the thing the first does not: nothing is going to run.
    expect(without.detail).toContain("لا يوجد عامل جمع");
    expect(withWorker.detail).not.toContain("لا يوجد عامل جمع");
  });

  it("tells a quiet channel apart from one with comments switched off", () => {
    const quiet = describeJob(
      row({
        status: "blocked",
        error_code: "no_upload_has_comments:12_checked_0_disabled",
      }),
      { workerConnected: true },
    );
    const off = describeJob(
      row({
        status: "blocked",
        error_code: "no_upload_has_comments:12_checked_9_disabled",
      }),
      { workerConnected: true },
    );
    expect(quiet.detail).toContain("12");
    expect(quiet.detail).toContain("هادئة");
    expect(off.detail).toContain("9");
    expect(off.detail).not.toContain("هادئة");
  });

  it("keeps the specific half of a compound code", () => {
    const scope = describeJob(
      row({
        status: "blocked",
        error_code: "source_access_denied:insufficientPermissions",
      }),
      { workerConnected: true },
    );
    const other = describeJob(
      row({ status: "blocked", error_code: "source_access_denied:forbidden" }),
      { workerConnected: true },
    );
    expect(scope.detail).toContain("أعد ربط القناة");
    // A different denial must not borrow the reconnect advice, which would
    // send the operator to re-authorise something that was not the problem.
    expect(other.detail).not.toContain("أعد ربط القناة");
    expect(other.detail).toContain("forbidden");
  });

  it("does not invent an explanation for a code it does not know", () => {
    const unknown = describeJob(
      row({ status: "failed", error_code: "wat_is_this" }),
      { workerConnected: true },
    );
    expect(unknown.detail).toContain("wat_is_this");
    expect(unknown.severity).toBe("critical");
  });

  it("does not promise comments when a run merely finished", () => {
    const done = describeJob(row({ status: "succeeded" }), {
      workerConnected: true,
    });
    expect(done.severity).toBe("ok");
    // A run against a video with no comments succeeds. Saying "collected the
    // comments" next to an empty table is the failure mode this guards.
    expect(done.detail).toContain("قد يكون صفرًا");
  });

  it("treats a supersede as bookkeeping rather than a fault", () => {
    const superseded = describeJob(
      row({
        status: "cancelled",
        error_code: "superseded_by_existing_request",
      }),
      { workerConnected: true },
    );
    const other = describeJob(row({ status: "cancelled" }), {
      workerConnected: true,
    });
    expect(superseded.severity).toBe("muted");
    expect(other.severity).toBe("warning");
  });
});

describe("what an operator may do with a job", () => {
  const at = (status: JobRow["status"]) =>
    describeJob(row({ status }), { workerConnected: true });

  it("offers withdrawal only before a worker has taken it", () => {
    expect(at("queued").cancellable).toBe(true);
    // A leased job belongs to the worker holding it. Cancelling underneath it
    // would let it commit to a job the operator believes is stopped.
    expect(at("running").cancellable).toBe(false);
    expect(at("succeeded").cancellable).toBe(false);
  });

  it("offers a retry only for work that finished without succeeding", () => {
    for (const s of ["failed", "blocked", "cancelled", "partial"] as const)
      expect(at(s).retryable).toBe(true);
    for (const s of ["queued", "running", "succeeded"] as const)
      expect(at(s).retryable).toBe(false);
  });
});
