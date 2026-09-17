/**
 * The demo copy of `/account`'s reads and its three self-service RPCs
 * (`rename_workspace`, `retire_workspace`, `oauth_disconnect`), replayed over
 * a fixture instead of Postgres. `Account.tsx` wires this in behind
 * `?demo=1` (phase 5), so the browser suite can drive the signed-in page
 * without a session.
 *
 * `reduceAccountDemo` is pure and refuses `invalid_name` the way
 * `rename_workspace` does (`supabase/migrations/20260917090000_rename_and_retire_a_workspace.sql`)
 * and `last_workspace` the way `retire_workspace` does — in the same
 * `{ message, code }` shape a PostgREST error carries.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_DEMO_FIXTURE,
  loadAccountDemo,
  reduceAccountDemo,
  type AccountDemo,
} from "./accountDemo";

const fixtureJson = readFileSync(
  "apps/web/public/fixtures/account.json",
  "utf8",
);

const A1 = "00000000-0000-4000-8000-0000000000a1"; // قناة سالم للتقنية
const A2 = "00000000-0000-4000-8000-0000000000a2"; // مطبخ ريم
const A3 = "00000000-0000-4000-8000-0000000000a3"; // عميل جديد

async function loaded(): Promise<AccountDemo> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(fixtureJson, { status: 200 })),
  );
  return loadAccountDemo();
}

describe("account.json", () => {
  it("parses via loadAccountDemo and carries the three workspaces", async () => {
    const state = await loaded();
    expect(state.workspaces.map((w) => w.id)).toEqual([A1, A2, A3]);
  });

  it("the third workspace has no client, no channel and no usage", async () => {
    const state = await loaded();
    expect(state.clients.some((c) => c.workspace_id === A3)).toBe(false);
    expect(state.channels.some((c) => c.workspace_id === A3)).toBe(false);
    expect(state.usage[A3]).toBeUndefined();
  });

  it("the first workspace's channel is connected; the second needs relinking", async () => {
    const state = await loaded();
    const ch1 = state.channels.find((c) => c.workspace_id === A1)!;
    const ch2 = state.channels.find((c) => c.workspace_id === A2)!;
    expect(ch1.status).toBe("connected");
    expect(ch1.handle).toBe("@salem.yjarrib");
    expect(ch2.status).not.toBe("connected");
    expect(ch2.handle).toBe("@reem.kitchen");
  });

  it("the first workspace's last job succeeded; the second's failed", async () => {
    const state = await loaded();
    const j1 = state.jobs.find((j) => j.workspace_id === A1)!;
    const j2 = state.jobs.find((j) => j.workspace_id === A2)!;
    expect(j1.status).toBe("succeeded");
    expect(j2.status).toBe("failed");
  });

  it("carries a UsageSummary per plan-holding workspace, each with at least one budget", async () => {
    const state = await loaded();
    expect(state.usage[A1].plan_key).toBe("creator_plus");
    expect(state.usage[A1].provider).toBe("paddle");
    expect(state.usage[A1].budgets.length).toBeGreaterThan(0);
    expect(state.usage[A2].plan_key).toBe("free");
    expect(state.usage[A2].budgets.length).toBeGreaterThan(0);
  });
});

describe("loadAccountDemo", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(fixtureJson, { status: 200 })),
    );
  });

  it("fetches from ACCOUNT_DEMO_FIXTURE", async () => {
    await loadAccountDemo();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      ACCOUNT_DEMO_FIXTURE,
      expect.anything(),
    );
  });

  it("rejects when the fixture cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await expect(loadAccountDemo()).rejects.toThrow();
  });
});

describe("reduceAccountDemo: rename", () => {
  it("sets the trimmed name", async () => {
    const state = await loaded();
    const out = reduceAccountDemo(state, {
      type: "rename",
      w: A2,
      name: "  مطبخ ريم الجديد  ",
    });
    expect(out.workspaces.find((w) => w.id === A2)?.name).toBe(
      "مطبخ ريم الجديد",
    );
  });

  it("refuses invalid_name for an empty (or whitespace-only) name", async () => {
    const state = await loaded();
    for (const name of ["", "   "]) {
      expect(() =>
        reduceAccountDemo(state, { type: "rename", w: A1, name }),
      ).toThrow(
        expect.objectContaining({ message: "invalid_name", code: "22023" }),
      );
    }
  });

  it("leaves every other workspace and every other row untouched", async () => {
    const state = await loaded();
    const out = reduceAccountDemo(state, {
      type: "rename",
      w: A2,
      name: "اسم آخر",
    });
    expect(out.workspaces.find((w) => w.id === A1)).toEqual(
      state.workspaces.find((w) => w.id === A1),
    );
    expect(out.channels).toEqual(state.channels);
    expect(out.jobs).toEqual(state.jobs);
    expect(out.usage).toEqual(state.usage);
  });

  it("does not mutate the input state", async () => {
    const state = await loaded();
    const before = JSON.stringify(state);
    reduceAccountDemo(state, { type: "rename", w: A2, name: "اسم آخر" });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("reduceAccountDemo: retire", () => {
  it("removes the workspace and its clients, channels, jobs and usage", async () => {
    const state = await loaded();
    const out = reduceAccountDemo(state, { type: "retire", w: A2 });
    expect(out.workspaces.map((w) => w.id)).toEqual([A1, A3]);
    expect(out.clients.some((c) => c.workspace_id === A2)).toBe(false);
    expect(out.channels.some((c) => c.workspace_id === A2)).toBe(false);
    expect(out.jobs.some((j) => j.workspace_id === A2)).toBe(false);
    expect(out.usage[A2]).toBeUndefined();
  });

  it("a workspace with no client, channel or usage retires cleanly", async () => {
    const state = await loaded();
    const out = reduceAccountDemo(state, { type: "retire", w: A3 });
    expect(out.workspaces.map((w) => w.id)).toEqual([A1, A2]);
  });

  it("refuses last_workspace when only one would remain", async () => {
    const state = await loaded();
    const afterTwo = reduceAccountDemo(state, { type: "retire", w: A2 });
    const afterOne = reduceAccountDemo(afterTwo, { type: "retire", w: A3 });
    expect(afterOne.workspaces).toHaveLength(1);
    expect(() =>
      reduceAccountDemo(afterOne, { type: "retire", w: A1 }),
    ).toThrow(
      expect.objectContaining({ message: "last_workspace", code: "55000" }),
    );
  });

  it("does not mutate the input state", async () => {
    const state = await loaded();
    const before = JSON.stringify(state);
    reduceAccountDemo(state, { type: "retire", w: A3 });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("reduceAccountDemo: disconnect", () => {
  it("removes the channel row for the workspace", async () => {
    const state = await loaded();
    const out = reduceAccountDemo(state, { type: "disconnect", w: A1 });
    expect(out.channels.some((c) => c.workspace_id === A1)).toBe(false);
    expect(out.channels).toHaveLength(state.channels.length - 1);
  });

  it("leaves the workspace, its client and the other channel untouched", async () => {
    const state = await loaded();
    const out = reduceAccountDemo(state, { type: "disconnect", w: A1 });
    expect(out.workspaces).toEqual(state.workspaces);
    expect(out.clients).toEqual(state.clients);
    expect(out.channels.find((c) => c.workspace_id === A2)).toEqual(
      state.channels.find((c) => c.workspace_id === A2),
    );
  });

  it("is a no-op when the workspace has no channel", async () => {
    const state = await loaded();
    const out = reduceAccountDemo(state, { type: "disconnect", w: A3 });
    expect(out.channels).toEqual(state.channels);
  });

  it("does not mutate the input state", async () => {
    const state = await loaded();
    const before = JSON.stringify(state);
    reduceAccountDemo(state, { type: "disconnect", w: A1 });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("reduceAccountDemo: connect", () => {
  it("returns an equal, but new, state", async () => {
    const state = await loaded();
    const out = reduceAccountDemo(state, { type: "connect", w: A2 });
    expect(out).toEqual(state);
    expect(out).not.toBe(state);
  });
});

describe("reduceAccountDemo: create", () => {
  it("appends a workspace with no client, channel or usage", async () => {
    const state = await loaded();
    const out = reduceAccountDemo(state, {
      type: "create",
      name: "مساحة رابعة",
    });
    expect(out.workspaces).toHaveLength(4);
    const added = out.workspaces[out.workspaces.length - 1];
    expect(added.name).toBe("مساحة رابعة");
    expect(added.id).toBe("00000000-0000-4000-8000-0000000000a4");
    expect(out.clients.some((c) => c.workspace_id === added.id)).toBe(false);
    expect(out.channels.some((c) => c.workspace_id === added.id)).toBe(false);
    expect(out.usage[added.id]).toBeUndefined();
  });

  it("leaves the existing three workspaces untouched", async () => {
    const state = await loaded();
    const out = reduceAccountDemo(state, {
      type: "create",
      name: "مساحة رابعة",
    });
    expect(out.workspaces.slice(0, 3)).toEqual(state.workspaces);
  });

  it("each create keeps ids sequential and hex-valid past the ninth workspace", async () => {
    let state = await loaded();
    for (let i = 0; i < 7; i++) {
      state = reduceAccountDemo(state, {
        type: "create",
        name: `مساحة ${i}`,
      });
    }
    // 3 seeded + 7 created = 10th workspace overall: a1..a9 exhausted, so
    // the tenth rolls to the b-suffix.
    expect(state.workspaces).toHaveLength(10);
    expect(state.workspaces[8].id).toBe("00000000-0000-4000-8000-0000000000a9");
    expect(state.workspaces[9].id).toBe("00000000-0000-4000-8000-0000000000b1");
  });

  it("does not mutate the input state", async () => {
    const state = await loaded();
    const before = JSON.stringify(state);
    reduceAccountDemo(state, { type: "create", name: "مساحة رابعة" });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("never reuses an id a retire freed up", async () => {
    const state = await loaded();
    // Retiring A2 drops the workspace count to two while "a3" is still in
    // use — a length-based next id would have handed the new workspace "a3"
    // right back, colliding with the one still on the list.
    const afterRetire = reduceAccountDemo(state, { type: "retire", w: A2 });
    const existingIds = new Set(afterRetire.workspaces.map((w) => w.id));

    const afterCreate1 = reduceAccountDemo(afterRetire, {
      type: "create",
      name: "مساحة جديدة 1",
    });
    const created1 =
      afterCreate1.workspaces[afterCreate1.workspaces.length - 1];
    expect(existingIds.has(created1.id)).toBe(false);

    const afterCreate2 = reduceAccountDemo(afterCreate1, {
      type: "create",
      name: "مساحة جديدة 2",
    });
    const created2 =
      afterCreate2.workspaces[afterCreate2.workspaces.length - 1];
    const allIds = afterCreate2.workspaces.map((w) => w.id);
    expect(created2.id).not.toBe(created1.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
