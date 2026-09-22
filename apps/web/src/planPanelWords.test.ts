import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import { planPanelWords } from "./planPanelWords";
import type { UsageSummary } from "@sentiment/contracts";

const summary = (over: Partial<UsageSummary>): UsageSummary => ({
  plan_key: "creator",
  status: "active",
  period_start: "2026-09-01T00:00:00Z",
  period_end: "2026-10-01T00:00:00Z",
  cancel_at_period_end: false,
  billing_interval: "month",
  provider: "paddle",
  plan: {
    key: "creator",
    segment: "individual",
    title_ar: "منشئ",
    title_en: "Creator",
    price_monthly_cents: 1200,
    price_yearly_cents: 12000,
    self_serve: true,
    provider_prices: {},
    allow_public_channels: false,
    limits: {
      analysis_units: 10000,
      topic_units: 4000,
      insight_reports: 10,
      channels: 1,
      members: 1,
      workspaces: 1,
      live_interval_minutes: 1440,
    },
  },
  budgets: [
    {
      event_type: "comment_analysis",
      used: 2500,
      allowance: 10000,
      granted: 0,
      remaining: 7500,
    },
  ],
  ...over,
});

describe("plan panel words", () => {
  it("a paddle subscriber manages and tops up", () => {
    const w = planPanelWords(summary({}), ar, "ar");
    expect(w.actions).toEqual(["manage", "topup"]);
    expect(w.rows[0]).toMatchObject({
      used: "2,500",
      allowance: "10,000",
      line: ar.planUsedOf("2,500", "10,000"),
      tone: "ok",
    });
  });
  it("a free workspace upgrades", () => {
    const w = planPanelWords(
      summary({
        provider: null,
        plan_key: "free",
        plan: { ...summary({}).plan!, key: "free", price_monthly_cents: 0 },
      }),
      ar,
      "ar",
    );
    expect(w.actions).toContain("upgrade");
  });
  it("past_due names the day the plan drops", () => {
    const w = planPanelWords(summary({ status: "past_due" }), ar, "ar");
    expect(w.notice).toBe(ar.planPastDue("2026-10-08"));
  });
  it("a cancelled renewal states its date once, under a short status", () => {
    const w = planPanelWords(summary({ cancel_at_period_end: true }), ar, "ar");
    expect(w.statusLine).toBe(ar.planStatusEnding);
    expect(w.statusLine).not.toContain("2026-10-01");
    expect(w.notice).toBe(ar.planEndsOn("2026-10-01"));
    // Past due outranks the cancellation: the sooner day is the one that matters.
    const due = planPanelWords(
      summary({ cancel_at_period_end: true, status: "past_due" }),
      ar,
      "ar",
    );
    expect(due.statusLine).toBe(ar.planStatusPastDue);
    expect(due.notice).toBe(ar.planPastDue("2026-10-08"));
  });
  it("an open-ended plan says it has no end date instead of a year a century away", () => {
    const w = planPanelWords(
      summary({
        provider: null,
        plan_key: "free",
        period_end: "2126-09-16T00:00:00Z",
      }),
      ar,
      "ar",
    );
    expect(w.statusLine).toBe(ar.planOpenEnded);
    expect(w.notice).toBeNull();
  });

  it("owner is unlimited and has no actions", () => {
    const w = planPanelWords(
      summary({
        provider: "admin",
        plan_key: "owner",
        plan: { ...summary({}).plan!, key: "owner", segment: "internal" },
        budgets: [
          {
            event_type: "comment_analysis",
            used: 1,
            allowance: -1,
            granted: 0,
            remaining: -1,
          },
        ],
      }),
      ar,
      "ar",
    );
    // One sentence, one key: the pricing page's "unlimited" is this one too.
    expect(w.rows[0].allowance).toBe(ar.pricingUnlimited);
    expect(w.rows[0].line).toBe(ar.planUsedUnlimited("1", ar.pricingUnlimited));
    expect(w.rows[0].line).not.toContain("من");
    expect(w.actions).toEqual([]);
  });
});
