import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import { en } from "./strings/en";
import { latestJobFromSync, setupProgress, setupSteps } from "./setup";

const statuses = (steps: ReturnType<typeof setupProgress>) =>
  steps.map((s) => s.status);

describe("where a workspace is on the three steps", () => {
  it("a bare workspace: connect is next, collecting cannot start yet", () => {
    const steps = setupProgress({ channel: null, latestJob: null }, ar);
    expect(statuses(steps)).toEqual(["done", "next", "later"]);
  });

  it("connected and never collected: collecting is the one thing to do", () => {
    const steps = setupProgress(
      { channel: { status: "connected" }, latestJob: null },
      ar,
    );
    expect(statuses(steps)).toEqual(["done", "done", "next"]);
  });

  it("a channel whose grant stopped working needs attention, not a repeat of step two", () => {
    for (const status of ["reconnect_required", "disconnected"]) {
      const steps = setupProgress({ channel: { status }, latestJob: null }, ar);
      expect(statuses(steps), status).toEqual(["done", "attention", "later"]);
      expect(steps[1].detail).toContain("إعادة ربط");
    }
  });

  it("a public channel chosen for monitoring completes step two and unlocks step three", () => {
    const steps = setupProgress(
      { channel: { status: "public_unverified" }, latestJob: null },
      ar,
    );
    expect(statuses(steps)).toEqual(["done", "done", "next"]);
    expect(steps[1].detail).toContain("القناة العامة");
  });

  it("a job that ran counts, partial included; one in flight is pending; one that stopped needs attention", () => {
    const at = (job: string) =>
      setupProgress(
        { channel: { status: "connected" }, latestJob: { status: job } },
        ar,
      );
    expect(statuses(at("succeeded"))).toEqual(["done", "done", "done"]);
    expect(statuses(at("partial"))).toEqual(["done", "done", "done"]);
    expect(statuses(at("queued"))[2]).toBe("pending");
    expect(statuses(at("running"))[2]).toBe("pending");
    for (const bad of ["failed", "blocked", "cancelled", "something_new"])
      expect(statuses(at(bad))[2], bad).toBe("attention");
  });

  it("uses the visitor's three sentences, unchanged", () => {
    const steps = setupProgress({ channel: null, latestJob: null }, ar);
    expect(steps.map((s) => s.title)).toEqual(
      setupSteps.map((s) => ar[s.title]),
    );
    expect(steps[1].title).toBe("اربط قناة يوتيوب بعد موافقتك على الإذن.");
    // And the English reads the same three keys, in the same order.
    expect(
      setupProgress({ channel: null, latestJob: null }, en).map((s) => s.title),
    ).toEqual(setupSteps.map((s) => en[s.title]));
    expect(setupProgress({ channel: null, latestJob: null }, en)[1].title).toBe(
      "Connect a YouTube channel after granting permission.",
    );
  });

  it("uses the dual-path sentence when allowPublicChannels is true (owner experiment)", () => {
    const stepsAr = setupProgress(
      { channel: null, latestJob: null, allowPublicChannels: true },
      ar,
    );
    expect(stepsAr[1].title).toBe(ar.stepChannelWithPublic);

    const stepsEn = setupProgress(
      { channel: null, latestJob: null, allowPublicChannels: true },
      en,
    );
    expect(stepsEn[1].title).toBe(en.stepChannelWithPublic);
  });
});

describe("the third step read from the sync state", () => {
  const sync = (over: Record<string, unknown>) =>
    ({
      worker: { connected: true, last_heartbeat_at: null, busy: false },
      queued_jobs: 0,
      last_run: null,
      ...over,
    }) as Parameters<typeof latestJobFromSync>[0];
  const run = (status: string) => ({
    status,
    started_at: "2026-09-15T00:00:00Z",
    ended_at: null,
    error_code: null,
    coverage: { videos_seen: 0, comments_seen: 0, complete: false },
  });

  it("is nothing when nothing was ever asked for", () => {
    expect(latestJobFromSync(null)).toBeNull();
    expect(latestJobFromSync(sync({}))).toBeNull();
  });

  it("is a queued request while one waits, whatever the last run said", () => {
    expect(
      latestJobFromSync(sync({ queued_jobs: 2, last_run: run("failed") })),
    ).toEqual({ status: "queued" });
  });

  it("is otherwise the last run's status, in the job's own words", () => {
    for (const status of [
      "running",
      "succeeded",
      "partial",
      "failed",
      "blocked",
    ])
      expect(latestJobFromSync(sync({ last_run: run(status) }))).toEqual({
        status,
      });
  });
});
