// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearTrail, readTrail, saveTrail, trailStep } from "./adminTrail";

const TRAIL = {
  back: "/admin/channels?state=failing",
  items: [
    { workspace_id: "w1", name: "One" },
    { workspace_id: "w2", name: "Two" },
    { workspace_id: "w3", name: "Three" },
  ],
};

describe("adminTrail", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("keeps the list for this tab and gives it back as it was", () => {
    expect(readTrail()).toBeNull();
    saveTrail(TRAIL);
    expect(readTrail()).toEqual(TRAIL);
    clearTrail();
    expect(readTrail()).toBeNull();
  });

  it("refuses a kept value that is not a trail, or leads outside the console", () => {
    window.sessionStorage.setItem("admin-trail:v1", "{not json");
    expect(readTrail()).toBeNull();
    window.sessionStorage.setItem(
      "admin-trail:v1",
      JSON.stringify({ ...TRAIL, back: "https://evil.example/" }),
    );
    expect(readTrail()).toBeNull();
    window.sessionStorage.setItem(
      "admin-trail:v1",
      JSON.stringify({ ...TRAIL, items: [{ workspace_id: 1 }] }),
    );
    expect(readTrail()).toBeNull();
  });

  it("places a workspace with its neighbours, and none at the ends", () => {
    expect(trailStep(TRAIL, "w2")).toEqual({
      back: TRAIL.back,
      name: "Two",
      position: 2,
      count: 3,
      prev: TRAIL.items[0],
      next: TRAIL.items[2],
    });
    expect(trailStep(TRAIL, "w1")).toMatchObject({ prev: null, position: 1 });
    expect(trailStep(TRAIL, "w3")).toMatchObject({ next: null, position: 3 });
  });

  it("says nothing for a workspace outside the list, or with no list", () => {
    expect(trailStep(TRAIL, "w9")).toBeNull();
    expect(trailStep(TRAIL, null)).toBeNull();
    expect(trailStep(null, "w1")).toBeNull();
  });
});
