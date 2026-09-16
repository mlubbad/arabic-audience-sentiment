import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import {
  adminErrorMessage,
  adminMonths,
  adminPlanOptions,
  adminRows,
  adminUnits,
} from "./adminWords";

describe("admin rows", () => {
  it("a workspace without a subscription reads as none", () => {
    const rows = adminRows(
      [
        {
          id: "w1",
          name: "x",
          created_by: "u",
          plan_key: null,
          status: null,
          period_end: null,
          provider: null,
        },
      ],
      ar,
    );
    expect(rows[0]).toMatchObject({
      plan: ar.adminNoPlan,
      status: "—",
      periodEnd: "—",
      provider: "—",
    });
  });
  it("a subscribed workspace reads its key, its state and its day", () => {
    const rows = adminRows(
      [
        {
          id: "w1",
          name: "x",
          created_by: "u",
          plan_key: "creator",
          status: "active",
          period_end: "2026-10-01T00:00:00+00:00",
          provider: "paddle",
        },
      ],
      ar,
    );
    expect(rows[0]).toEqual({
      id: "w1",
      name: "x",
      plan: "creator",
      status: "active",
      periodEnd: "2026-10-01",
      provider: "paddle",
    });
  });
});

describe("admin plan keys", () => {
  it("plan options carry the title in the reader's language, keyed by the key", () => {
    const rows = [
      { key: "free", title_ar: "مجاني", title_en: "Free" },
      { key: "pilot", title_ar: "شريك مؤسِّس", title_en: "Founding Partner" },
    ];
    expect(adminPlanOptions(rows, "ar")).toEqual([
      { key: "free", label: "مجاني" },
      { key: "pilot", label: "شريك مؤسِّس" },
    ]);
    expect(adminPlanOptions(rows, "en")[1].label).toBe("Founding Partner");
  });
});

describe("admin fields", () => {
  it("months are whole numbers from 1 to 1200", () => {
    expect(adminMonths("1")).toBe(1);
    expect(adminMonths("1200")).toBe(1200);
    expect(adminMonths("0")).toBeNull();
    expect(adminMonths("1201")).toBeNull();
    expect(adminMonths("1.5")).toBeNull();
    expect(adminMonths("")).toBeNull();
  });
  it("units are whole numbers above zero", () => {
    expect(adminUnits("10000")).toBe(10000);
    expect(adminUnits("0")).toBeNull();
    expect(adminUnits("-5")).toBeNull();
    expect(adminUnits("x")).toBeNull();
  });
});

describe("admin errors", () => {
  it("forbidden is a sentence; a known refusal shows its name", () => {
    expect(adminErrorMessage({ message: "forbidden", code: "42501" }, ar)).toBe(
      ar.adminForbidden,
    );
    expect(
      adminErrorMessage({ message: "unknown_plan", code: "22023" }, ar),
    ).toBe(ar.adminFailed("unknown_plan"));
    expect(
      adminErrorMessage({ message: "invalid_months", code: "22023" }, ar),
    ).toBe(ar.adminFailed("invalid_months"));
    expect(
      adminErrorMessage({ message: "no_active_plan", code: "42501" }, ar),
    ).toBe(ar.adminFailed("no_active_plan"));
  });
  it("a live Paddle subscription is its own sentence, asking for override", () => {
    expect(
      adminErrorMessage(
        { message: "paddle_subscription_active", code: "55000" },
        ar,
      ),
    ).toBe(ar.adminPaddleActive);
    expect(ar.adminPaddleActive).toContain("Paddle");
    expect(ar.adminOverride).toContain("Paddle");
  });
  it("anything else shows its code, never its text", () => {
    const out = adminErrorMessage(
      {
        message: "https://x.supabase.co/rest/v1/rpc?key=secret",
        code: "PGRST301",
      },
      ar,
    );
    expect(out).toBe(ar.adminFailed("PGRST301"));
    expect(out).not.toContain("secret");
    expect(adminErrorMessage(new TypeError("Failed to fetch"), ar)).toBe(
      ar.adminFailed("unknown_error"),
    );
  });
});
