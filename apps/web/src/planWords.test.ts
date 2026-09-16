import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import { planCardWords } from "./planWords";

const plan = (used: number, allowance = 1000) => ({
  plan_key: "pilot",
  status: "active" as const,
  period_start: "2026-09-01T00:00:00Z",
  period_end: "2026-10-01T00:00:00Z",
  cancel_at_period_end: false,
  billing_interval: null,
  provider: null,
  budgets: [
    {
      event_type: "comment_analysis" as const,
      used,
      allowance,
      granted: 0,
      remaining: Math.max(allowance - used, 0),
    },
    {
      event_type: "historical_backfill" as const,
      used: 0,
      allowance: 5,
      granted: 0,
      remaining: 5,
    },
  ],
});

const base = {
  workspaceName: "قناة الأخبار",
  choosing: false,
  loading: false,
  failed: false,
  plan: null,
};

describe("the rail's plan card", () => {
  it("carries the number, not a signpost to it", () => {
    const w = planCardWords({ ...base, plan: plan(250) }, ar);
    expect(w.kicker).toBe("قناة الأخبار");
    expect(w.title).toBe("خطة pilot");
    expect(w.note).toBe("تحليل التعليقات: يتبقى 750 من 1,000");
    expect(w.tone).toBe("ok");
    // The words that used to stand in for the figure are gone.
    expect(w.note).not.toContain("في صفحة التشغيل");
  });

  it("takes its colour from the same thresholds the operations page uses", () => {
    expect(planCardWords({ ...base, plan: plan(700) }, ar).tone).toBe(
      "warning",
    );
    expect(planCardWords({ ...base, plan: plan(850) }, ar).tone).toBe(
      "critical",
    );
    const out = planCardWords({ ...base, plan: plan(1000) }, ar);
    expect(out.tone).toBe("exhausted");
    expect(out.note).toContain("نفد الحد");
  });

  it("does not read a failed read, or no plan, as a limit reached", () => {
    const failed = planCardWords({ ...base, failed: true }, ar);
    expect(failed.title).toBe("تعذّرت قراءة الخطة");
    expect(failed.note).toContain("لا يعني ذلك نفاد الحد");
    expect(failed.tone).toBe("none");
    const none = planCardWords(base, ar);
    expect(none.title).toBe("لا خطة مفعّلة");
    expect(none.tone).toBe("none");
  });

  it("says an internal plan has no ceiling, not a negative one", () => {
    const owner = plan(1, -1);
    owner.budgets[0].remaining = -1;
    const w = planCardWords({ ...base, plan: owner }, ar);
    expect(w.note).toBe(`تحليل التعليقات: ${ar.pricingUnlimited}`);
    expect(w.note).not.toContain("-1");
    expect(w.tone).toBe("ok");
  });

  it("asks for a workspace before it claims a figure for one", () => {
    const w = planCardWords(
      { ...base, workspaceName: null, choosing: true, plan: plan(0) },
      ar,
    );
    expect(w.kicker).toBe("لم تُختر مساحة عمل");
    expect(w.note).not.toContain("يتبقى");
  });
});
