import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ar } from "./strings/ar";
import { en } from "./strings/en";
import {
  adminErrorMessage,
  adminMonths,
  adminPlanOptions,
  adminRows,
  adminUnits,
  adminWriteFailure,
  auditActionLabel,
  periodEndLabel,
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
  it("a subscribed workspace reads its plan's name, its state and provider in words, and its day", () => {
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
      [{ key: "creator", label: "صانع المحتوى" }],
    );
    expect(rows[0]).toEqual({
      id: "w1",
      name: "x",
      plan: "صانع المحتوى",
      status: ar.adminStatusLabels.active,
      periodEnd: "2026-10-01",
      provider: "Paddle",
    });
  });

  it("shows an unknown plan, status or provider as is rather than hiding it", () => {
    const [row] = adminRows(
      [
        {
          id: "w1",
          name: "x",
          created_by: "u",
          plan_key: "t",
          status: "trialing",
          period_end: null,
          provider: "stripe",
        },
      ],
      ar,
    );
    expect(row).toMatchObject({
      plan: "t",
      status: "trialing",
      provider: "stripe",
    });
  });
});

describe("a period's end", () => {
  const now = new Date("2026-10-13T00:00:00Z");
  it("is the day for a real end, and 'no end date' for one a century out", () => {
    expect(periodEndLabel("2026-11-13T00:00:00+00:00", ar, now)).toBe(
      "2026-11-13",
    );
    // The free plan is written 100 years ahead (review finding 17: 2126-10-13).
    expect(periodEndLabel("2126-10-13T00:00:00+00:00", ar, now)).toBe(
      ar.adminNoEnd,
    );
    expect(periodEndLabel("2076-10-13T00:00:00+00:00", ar, now)).toBe(
      ar.adminNoEnd,
    );
    expect(periodEndLabel("2075-10-13T00:00:00+00:00", ar, now)).toBe(
      "2075-10-13",
    );
    expect(periodEndLabel(null, ar, now)).toBe("—");
  });
});

describe("audit actions in words", () => {
  it("names every action the database writes, in both languages", () => {
    // Every literal action in an `insert into public.audit_events` of the
    // current schema, plus the ones the admin-users Edge Function records.
    const schema = readFileSync("supabase/schema/current.sql", "utf8");
    const written = new Set<string>();
    for (const m of schema.matchAll(
      /insert into public\.audit_events\s*\([^)]*\)\s*(?:values\s*\(|select)([\s\S]*?)(?:;|\)\s*(?:on conflict|returning|$))/gi,
    ))
      for (const a of (m[1] ?? "").matchAll(/'([a-z]+(?:_[a-z]+)+)'/g))
        written.add(a[1]!);
    for (const a of [
      "password_link_created",
      "user_suspended",
      "user_unsuspended",
      "email_confirmed",
      "email_changed",
      "password_reset_sent",
    ])
      written.add(a);
    // Targets and arguments that share the lists' shape but are not actions.
    for (const notAction of ["usage_grant", "plan_paddle_"])
      written.delete(notAction);
    expect(written.size).toBeGreaterThan(20);
    const missing = [...written].filter(
      (a) => !ar.adminAccountActions[a] || !en.adminAccountActions[a],
    );
    expect(missing).toEqual([]);
  });

  it("names Paddle's subscription events, and shows anything else as is", () => {
    expect(auditActionLabel("plan_set", ar)).toBe(
      ar.adminAccountActions.plan_set,
    );
    expect(auditActionLabel("plan_paddle_updated", en)).toBe(
      "Paddle: subscription updated",
    );
    expect(auditActionLabel("something_new", ar)).toBe("something_new");
  });
});

describe("a write that did not happen", () => {
  it("is the page's sentence with the database's code, never the error's text", () => {
    const refused = Object.assign(new Error("live_unavailable"), {
      code: "42501",
    });
    expect(adminWriteFailure("تعذر الحفظ.", refused)).toBe(
      "تعذر الحفظ. (42501)",
    );
    // A code that is not a database code is dropped, not echoed.
    expect(
      adminWriteFailure("تعذر الحفظ.", { code: "https://x.supabase.co?key=1" }),
    ).toBe("تعذر الحفظ.");
    expect(adminWriteFailure("تعذر الحفظ.", undefined)).toBe("تعذر الحفظ.");
  });
});

describe("admin plan keys", () => {
  it("plan options carry the title in the reader's language, keyed by the key", () => {
    const rows = [
      { key: "free", title_ar: "مجاني", title_en: "Free" },
      { key: "pilot", title_ar: "شريك تسويقي", title_en: "Marketing Partner" },
    ];
    expect(adminPlanOptions(rows, "ar")).toEqual([
      { key: "free", label: "مجاني" },
      { key: "pilot", label: "شريك تسويقي" },
    ]);
    expect(adminPlanOptions(rows, "en")[1].label).toBe("Marketing Partner");
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

describe("a refusal in words", () => {
  it("says a call ran out of time in a sentence, not as 57014", () => {
    expect(
      adminErrorMessage({ code: "57014", message: "live_unavailable" }, ar),
    ).toBe(ar.adminTimedOut);
  });
});
