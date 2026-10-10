import { describe, expect, it } from "vitest";
import type { AdminDailyDigest } from "@sentiment/contracts";
import { digestView } from "./dailyDigest";

const states = {
  paused: 0,
  cataloguing: 0,
  collecting: 0,
  failing: 0,
  new: 0,
  waiting: 0,
  stale: 4,
  healthy: 9,
};
const fail = (id: string) => ({
  channel_id: `10000000-0000-4000-8000-00000000000${id}`,
  title: `Ch ${id}`,
  handle: null,
  error_code: "quota_exceeded",
});
const snap = (
  day: string,
  failing: ReturnType<typeof fail>[],
  comments: number,
  analysed: number,
) => ({
  day,
  recorded_at: `${day}T03:53:00+00:00`,
  body: {
    states,
    failing,
    comments,
    analysed,
    failed_runs: 2,
    imported: 1,
    movers: [],
  },
});

describe("digestView", () => {
  it("is nothing before the first snapshot", () => {
    expect(digestView({ latest: null, previous: null })).toBeNull();
  });

  it("splits failures into new and recovered against the snapshot before", () => {
    const d: AdminDailyDigest = {
      latest: snap("2026-10-10", [fail("1"), fail("2")], 1500, 900),
      previous: snap("2026-10-09", [fail("2"), fail("3")], 1000, 600),
    };
    const v = digestView(d)!;
    expect(v.compared).toBe(true);
    expect(v.newlyFailing.map((f) => f.title)).toEqual(["Ch 1"]);
    expect(v.recovered.map((f) => f.title)).toEqual(["Ch 3"]);
    expect(v.collected).toBe(500);
    expect(v.analysed).toBe(300);
    expect(v).toMatchObject({ stale: 4, failedRuns: 2, imported: 1 });
  });

  it("never reports a negative number when a total fell", () => {
    const v = digestView({
      latest: snap("2026-10-10", [], 800, 500),
      previous: snap("2026-10-09", [], 1000, 600),
    })!;
    expect(v.collected).toBe(0);
    expect(v.analysed).toBe(0);
  });

  it("on the first snapshot compares nothing and lists what fails now", () => {
    const v = digestView({
      latest: snap("2026-10-10", [fail("1")], 1500, 900),
      previous: null,
    })!;
    expect(v.compared).toBe(false);
    expect(v.newlyFailing).toEqual([]);
    expect(v.recovered).toEqual([]);
    expect(v.failing).toHaveLength(1);
    expect(v.collected).toBeNull();
  });
});
