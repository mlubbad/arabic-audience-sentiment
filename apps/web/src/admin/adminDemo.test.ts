/**
 * The demo copy of `/admin`'s server calls: a fixture read and a pure
 * reducer that refuses exactly what `set_workspace_plan`, `grant_pack` and
 * `delete_workspace` refuse (see the migrations named in each `it` below),
 * so `adminErrorMessage` shows the same sentence whether the refusal came
 * from Postgres or from this module.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminWorkspacesSchema,
  type AdminWorkspace,
} from "@sentiment/contracts";
import { fixtureCatalogue } from "../data";
import { adminErrorMessage } from "../adminWords";
import { ar } from "../strings/ar";
import {
  ADMIN_DEMO_FIXTURE,
  DEMO_BILLING_ROOT_ID,
  DEMO_OWNER_ID,
  loadAdminDemo,
  reduceAdminDemo,
} from "./adminDemo";

const fixtureJson = readFileSync("apps/web/public/fixtures/admin.json", "utf8");
const fixtureRows = AdminWorkspacesSchema.parse(JSON.parse(fixtureJson));
const PLAN_KEYS = new Set(fixtureCatalogue.map((p) => p.key));
const NOW = new Date("2026-09-17T12:00:00Z");

function row(id: string): AdminWorkspace {
  const found = fixtureRows.find((r) => r.id === id);
  if (!found) throw new Error(`fixture is missing row ${id}`);
  return found;
}

// The six ids, named the way the brief numbers them, so a failing test names
// a row instead of a bare index.
const PERSONAL = "00000000-0000-4000-8000-000000000001"; // مساحة العمل الشخصية
const REEM = "00000000-0000-4000-8000-000000000002"; // قناة ريم للطبخ
const AGENCY = "00000000-0000-4000-8000-000000000003"; // وكالة نبض الإعلامية
const STUDIO = "00000000-0000-4000-8000-000000000004"; // استوديو المدى
const CLIENT_1 = "00000000-0000-4000-8000-000000000005"; // عميل للتسليم 1
const NO_PLAN = "00000000-0000-4000-8000-000000000006"; // مساحة بلا خطة

describe("admin.json", () => {
  it("parses against AdminWorkspacesSchema and carries six rows", () => {
    expect(fixtureRows).toHaveLength(6);
  });

  it("row 1 is the owner's billing root, and the constants name it", () => {
    expect(DEMO_BILLING_ROOT_ID).toBe(PERSONAL);
    expect(row(PERSONAL).created_by).toBe(DEMO_OWNER_ID);
  });

  it("row 5 is a second workspace created by the owner (retired-to-owner client)", () => {
    expect(row(CLIENT_1).created_by).toBe(DEMO_OWNER_ID);
    expect(row(CLIENT_1).id).not.toBe(DEMO_BILLING_ROOT_ID);
  });

  it("row 6 carries all four subscription fields null", () => {
    const r = row(NO_PLAN);
    expect(r.plan_key).toBeNull();
    expect(r.status).toBeNull();
    expect(r.period_end).toBeNull();
    expect(r.provider).toBeNull();
  });

  it("rows 3 and 4 are on an active/past_due Paddle subscription", () => {
    expect(row(AGENCY)).toMatchObject({ provider: "paddle", status: "active" });
    expect(row(STUDIO)).toMatchObject({
      provider: "paddle",
      status: "past_due",
    });
  });

  it("every plan_key present is one loadAdminDemo's caller would offer", () => {
    for (const r of fixtureRows) {
      if (r.plan_key !== null) expect(PLAN_KEYS.has(r.plan_key)).toBe(true);
    }
  });
});

describe("loadAdminDemo", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(fixtureJson, { status: 200 })),
    );
  });

  it("fetches the fixture and parses it", async () => {
    const rows = await loadAdminDemo();
    expect(rows).toEqual(fixtureRows);
  });

  it("fetches from ADMIN_DEMO_FIXTURE", async () => {
    await loadAdminDemo();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      ADMIN_DEMO_FIXTURE,
      expect.anything(),
    );
  });
});

describe("reduceAdminDemo: set_plan", () => {
  const opts = { planKeys: PLAN_KEYS, now: NOW };

  it("refuses unknown_plan for a key the catalogue does not have", () => {
    expect(() =>
      reduceAdminDemo(
        fixtureRows,
        {
          type: "set_plan",
          w: REEM,
          plan_key: "owner",
          months: 1,
          note: null,
          override: false,
        },
        opts,
      ),
    ).toThrow(
      expect.objectContaining({ message: "unknown_plan", code: "22023" }),
    );
  });

  it("refuses invalid_months below 1 or above 1200", () => {
    for (const months of [0, -1, 1201]) {
      expect(() =>
        reduceAdminDemo(
          fixtureRows,
          {
            type: "set_plan",
            w: REEM,
            plan_key: "creator",
            months,
            note: null,
            override: false,
          },
          opts,
        ),
      ).toThrow(
        expect.objectContaining({ message: "invalid_months", code: "22023" }),
      );
    }
  });

  it("refuses paddle_subscription_active over an active Paddle root without override", () => {
    expect(() =>
      reduceAdminDemo(
        fixtureRows,
        {
          type: "set_plan",
          w: AGENCY,
          plan_key: "creator",
          months: 1,
          note: null,
          override: false,
        },
        opts,
      ),
    ).toThrow(
      expect.objectContaining({
        message: "paddle_subscription_active",
        code: "55000",
      }),
    );
  });

  it("refuses paddle_subscription_active over a past_due Paddle root without override", () => {
    expect(() =>
      reduceAdminDemo(
        fixtureRows,
        {
          type: "set_plan",
          w: STUDIO,
          plan_key: "creator",
          months: 1,
          note: null,
          override: false,
        },
        opts,
      ),
    ).toThrow(
      expect.objectContaining({ message: "paddle_subscription_active" }),
    );
  });

  it("with override, sets the plan over Paddle and keeps the Paddle provider", () => {
    const out = reduceAdminDemo(
      fixtureRows,
      {
        type: "set_plan",
        w: AGENCY,
        plan_key: "media",
        months: 3,
        note: "override test",
        override: true,
      },
      opts,
    );
    const changed = out.find((r) => r.id === AGENCY)!;
    expect(changed.plan_key).toBe("media");
    expect(changed.status).toBe("active");
    expect(changed.provider).toBe("paddle");
    expect(changed.period_end).toBe(
      new Date("2026-12-17T12:00:00Z").toISOString(),
    );
  });

  it("over a workspace with no provider, sets plan/status/period_end and provider admin", () => {
    const out = reduceAdminDemo(
      fixtureRows,
      {
        type: "set_plan",
        w: NO_PLAN,
        plan_key: "free",
        months: 1,
        note: null,
        override: false,
      },
      opts,
    );
    const changed = out.find((r) => r.id === NO_PLAN)!;
    expect(changed).toMatchObject({
      plan_key: "free",
      status: "active",
      provider: "admin",
    });
    expect(changed.period_end).toBe(
      new Date("2026-10-17T12:00:00Z").toISOString(),
    );
  });

  it("does not mutate the input array or its rows", () => {
    const before = JSON.stringify(fixtureRows);
    reduceAdminDemo(
      fixtureRows,
      {
        type: "set_plan",
        w: NO_PLAN,
        plan_key: "free",
        months: 1,
        note: null,
        override: false,
      },
      opts,
    );
    expect(JSON.stringify(fixtureRows)).toBe(before);
  });

  it("leaves every other row untouched", () => {
    const out = reduceAdminDemo(
      fixtureRows,
      {
        type: "set_plan",
        w: NO_PLAN,
        plan_key: "free",
        months: 1,
        note: null,
        override: false,
      },
      opts,
    );
    for (const id of [PERSONAL, REEM, AGENCY, STUDIO, CLIENT_1]) {
      expect(out.find((r) => r.id === id)).toEqual(row(id));
    }
  });
});

describe("reduceAdminDemo: grant_pack", () => {
  const opts = { planKeys: PLAN_KEYS, now: NOW };

  it("refuses no_active_plan when the row has no plan", () => {
    expect(() =>
      reduceAdminDemo(
        fixtureRows,
        {
          type: "grant_pack",
          w: NO_PLAN,
          kind: "comment_analysis",
          units: 10000,
          note: "n",
        },
        opts,
      ),
    ).toThrow(
      expect.objectContaining({ message: "no_active_plan", code: "42501" }),
    );
  });

  it("refuses no_active_plan when the row's status is not active (past_due)", () => {
    expect(() =>
      reduceAdminDemo(
        fixtureRows,
        {
          type: "grant_pack",
          w: STUDIO,
          kind: "topic_classification",
          units: 500,
          note: "n",
        },
        opts,
      ),
    ).toThrow(expect.objectContaining({ message: "no_active_plan" }));
  });

  it("otherwise returns a new array with every row unchanged", () => {
    const out = reduceAdminDemo(
      fixtureRows,
      {
        type: "grant_pack",
        w: PERSONAL,
        kind: "comment_analysis",
        units: 10000,
        note: "n",
      },
      opts,
    );
    expect(out).not.toBe(fixtureRows);
    expect(out).toEqual(fixtureRows);
  });
});

describe("reduceAdminDemo: delete", () => {
  const opts = { planKeys: PLAN_KEYS, now: NOW };

  it("refuses last_workspace before billing_root when only one owner row would remain", () => {
    // Delete row 5 first so row 1 becomes the owner's only remaining row.
    const afterClient1 = reduceAdminDemo(
      fixtureRows,
      { type: "delete", w: CLIENT_1 },
      opts,
    );
    expect(() =>
      reduceAdminDemo(afterClient1, { type: "delete", w: PERSONAL }, opts),
    ).toThrow(
      expect.objectContaining({ message: "last_workspace", code: "55000" }),
    );
  });

  it("refuses billing_root for row 1 while the owner has another row", () => {
    expect(() =>
      reduceAdminDemo(fixtureRows, { type: "delete", w: PERSONAL }, opts),
    ).toThrow(
      expect.objectContaining({ message: "billing_root", code: "55000" }),
    );
  });

  it("refuses paddle_subscription_active for an active Paddle row (row 3)", () => {
    expect(() =>
      reduceAdminDemo(fixtureRows, { type: "delete", w: AGENCY }, opts),
    ).toThrow(
      expect.objectContaining({
        message: "paddle_subscription_active",
        code: "55000",
      }),
    );
  });

  it("refuses paddle_subscription_active for a past_due Paddle row (row 4)", () => {
    expect(() =>
      reduceAdminDemo(fixtureRows, { type: "delete", w: STUDIO }, opts),
    ).toThrow(
      expect.objectContaining({ message: "paddle_subscription_active" }),
    );
  });

  it("removes a non-root, non-Paddle row (row 2)", () => {
    const out = reduceAdminDemo(fixtureRows, { type: "delete", w: REEM }, opts);
    expect(out.find((r) => r.id === REEM)).toBeUndefined();
    expect(out).toHaveLength(5);
  });

  it("removes row 6 (no plan, no provider)", () => {
    const out = reduceAdminDemo(
      fixtureRows,
      { type: "delete", w: NO_PLAN },
      opts,
    );
    expect(out.find((r) => r.id === NO_PLAN)).toBeUndefined();
  });

  it("removes row 5, the retired-to-owner client, because the owner keeps row 1", () => {
    const out = reduceAdminDemo(
      fixtureRows,
      { type: "delete", w: CLIENT_1 },
      opts,
    );
    expect(out.find((r) => r.id === CLIENT_1)).toBeUndefined();
    expect(out).toHaveLength(5);
  });

  it("does not mutate the input array", () => {
    const before = fixtureRows.length;
    reduceAdminDemo(fixtureRows, { type: "delete", w: REEM }, opts);
    expect(fixtureRows).toHaveLength(before);
  });
});

describe("every refusal maps through adminErrorMessage to the live page's sentence", () => {
  const opts = { planKeys: PLAN_KEYS, now: NOW };

  function caught(fn: () => unknown): unknown {
    try {
      fn();
      throw new Error("expected a throw");
    } catch (e) {
      return e;
    }
  }

  it("paddle_subscription_active -> adminPaddleActive", () => {
    const err = caught(() =>
      reduceAdminDemo(fixtureRows, { type: "delete", w: AGENCY }, opts),
    );
    expect(adminErrorMessage(err, ar)).toBe(ar.adminPaddleActive);
  });

  it("billing_root -> adminDeleteBillingRoot", () => {
    const err = caught(() =>
      reduceAdminDemo(fixtureRows, { type: "delete", w: PERSONAL }, opts),
    );
    expect(adminErrorMessage(err, ar)).toBe(ar.adminDeleteBillingRoot);
  });

  it("last_workspace -> adminDeleteLast", () => {
    const afterClient1 = reduceAdminDemo(
      fixtureRows,
      { type: "delete", w: CLIENT_1 },
      opts,
    );
    const err = caught(() =>
      reduceAdminDemo(afterClient1, { type: "delete", w: PERSONAL }, opts),
    );
    expect(adminErrorMessage(err, ar)).toBe(ar.adminDeleteLast);
  });

  it("unknown_plan -> adminFailed('unknown_plan')", () => {
    const err = caught(() =>
      reduceAdminDemo(
        fixtureRows,
        {
          type: "set_plan",
          w: REEM,
          plan_key: "owner",
          months: 1,
          note: null,
          override: false,
        },
        opts,
      ),
    );
    expect(adminErrorMessage(err, ar)).toBe(ar.adminFailed("unknown_plan"));
  });

  it("invalid_months -> adminFailed('invalid_months')", () => {
    const err = caught(() =>
      reduceAdminDemo(
        fixtureRows,
        {
          type: "set_plan",
          w: REEM,
          plan_key: "creator",
          months: 0,
          note: null,
          override: false,
        },
        opts,
      ),
    );
    expect(adminErrorMessage(err, ar)).toBe(ar.adminFailed("invalid_months"));
  });

  it("no_active_plan -> adminFailed('no_active_plan')", () => {
    const err = caught(() =>
      reduceAdminDemo(
        fixtureRows,
        {
          type: "grant_pack",
          w: NO_PLAN,
          kind: "comment_analysis",
          units: 1,
          note: "n",
        },
        opts,
      ),
    );
    expect(adminErrorMessage(err, ar)).toBe(ar.adminFailed("no_active_plan"));
  });
});
