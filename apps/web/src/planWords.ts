/**
 * What the rail's plan card says, decided away from the rail.
 *
 * The card's own comment promised "what your plan has left — true on every
 * screen". What it rendered was "خطة الـPilot" over "الحدود والاستهلاك في صفحة
 * التشغيل": a signpost to the number, on the one surface that exists to carry
 * the number. The reader who needed to know whether they could start a
 * collection still had to open the operations page to find out.
 *
 * This takes the plan as `usage_summary` returns it and the state around it,
 * and returns words. The remaining figure is the analysis budget's, because
 * that is the limit a collection runs into; the backfill budget stays on the
 * operations page with the rest of the detail.
 */
import {
  budgetState,
  unlimited,
  type UsageSummary,
} from "@sentiment/contracts";
import type { Strings } from "./strings";

export type PlanCardWords = {
  /** The workspace the figures belong to, or why there is none. */
  kicker: string;
  title: string;
  note: string;
  /** Drives colour only; the words above already say it. */
  tone: "ok" | "warning" | "critical" | "exhausted" | "none";
};

export function planCardWords(
  input: {
    workspaceName: string | null;
    /** Signed in with more than one workspace and none chosen yet. */
    choosing: boolean;
    loading: boolean;
    failed: boolean;
    plan: UsageSummary | null;
  },
  S: Strings,
): PlanCardWords {
  const { workspaceName, choosing, loading, failed, plan } = input;
  if (choosing)
    return {
      kicker: S.planNoneChosenKicker,
      title: S.planNoneChosenTitle,
      note: S.planNoneChosenNote,
      tone: "none",
    };
  const kicker = workspaceName ?? S.planKickerFallback;
  if (loading) return { kicker, title: S.planLoading, note: "", tone: "none" };
  if (failed)
    return {
      kicker,
      title: S.planFailedTitle,
      // Not "no plan": a failed read says nothing about the limit either way.
      note: S.planFailedNote,
      tone: "none",
    };
  if (!plan)
    return {
      kicker,
      title: S.planNoneTitle,
      note: S.planNoneNote,
      tone: "none",
    };
  const analysis =
    plan.budgets.find((b) => b.event_type === "comment_analysis") ??
    plan.budgets[0];
  const tone = budgetState(analysis);
  // Western digits, as the report uses them.
  const n = (v: number) => v.toLocaleString("en-US");
  const name =
    analysis.event_type === "comment_analysis"
      ? S.budgetAnalysis
      : S.budgetBackfill;
  return {
    kicker,
    title: S.planTitle(plan.plan_key),
    // A -1 ceiling is not there: "يتبقى -1 من -1" would be a number where
    // the truth is that there is nothing to count down.
    note: unlimited(analysis)
      ? `${name}: ${S.pricingUnlimited}`
      : tone === "exhausted"
        ? S.planExhausted(name, n(analysis.allowance))
        : S.planRemaining(name, n(analysis.remaining), n(analysis.allowance)),
    tone,
  };
}
