import { describe, expect, it } from "vitest";
import { setupProgress, setupSteps } from "./setup";

const statuses = (steps: ReturnType<typeof setupProgress>) =>
  steps.map((s) => s.status);

describe("where a workspace is on the three steps", () => {
  it("a bare workspace: connect is next, collecting cannot start yet", () => {
    const steps = setupProgress({ channel: null, latestJob: null });
    expect(statuses(steps)).toEqual(["done", "next", "later"]);
  });

  it("connected and never collected: collecting is the one thing to do", () => {
    const steps = setupProgress({
      channel: { status: "connected" },
      latestJob: null,
    });
    expect(statuses(steps)).toEqual(["done", "done", "next"]);
  });

  it("a channel whose grant stopped working needs attention, not a repeat of step two", () => {
    for (const status of ["reconnect_required", "disconnected"]) {
      const steps = setupProgress({ channel: { status }, latestJob: null });
      expect(statuses(steps), status).toEqual(["done", "attention", "later"]);
      expect(steps[1].detail).toContain("إعادة ربط");
    }
  });

  it("a public channel the operator seeded is step two not yet taken, not step two gone wrong", () => {
    const steps = setupProgress({
      channel: { status: "public_unverified" },
      latestJob: null,
    });
    expect(statuses(steps)).toEqual(["done", "next", "later"]);
    expect(steps[1].detail).toContain("ملكيتها");
  });

  it("a job that ran counts, partial included; one in flight is pending; one that stopped needs attention", () => {
    const at = (job: string) =>
      setupProgress({
        channel: { status: "connected" },
        latestJob: { status: job },
      });
    expect(statuses(at("succeeded"))).toEqual(["done", "done", "done"]);
    expect(statuses(at("partial"))).toEqual(["done", "done", "done"]);
    expect(statuses(at("queued"))[2]).toBe("pending");
    expect(statuses(at("running"))[2]).toBe("pending");
    for (const bad of ["failed", "blocked", "cancelled", "something_new"])
      expect(statuses(at(bad))[2], bad).toBe("attention");
  });

  it("uses the visitor's three sentences, unchanged", () => {
    const steps = setupProgress({ channel: null, latestJob: null });
    expect(steps.map((s) => s.title)).toEqual(setupSteps.map((s) => s.title));
  });
});
