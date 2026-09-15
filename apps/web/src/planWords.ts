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
import { budgetState, type UsageSummary } from "@sentiment/contracts";
import { budgetNames } from "./i18n";

export type PlanCardWords = {
  /** The workspace the figures belong to, or why there is none. */
  kicker: string;
  title: string;
  note: string;
  /** Drives colour only; the words above already say it. */
  tone: "ok" | "warning" | "critical" | "exhausted" | "none";
};

export function planCardWords(input: {
  workspaceName: string | null;
  /** Signed in with more than one workspace and none chosen yet. */
  choosing: boolean;
  loading: boolean;
  failed: boolean;
  plan: UsageSummary | null;
}): PlanCardWords {
  const { workspaceName, choosing, loading, failed, plan } = input;
  if (choosing)
    return {
      kicker: "لم تُختر مساحة عمل",
      title: "الحدود لكل مساحة",
      note: "اختر مساحة عمل لترى ما تبقّى من خطتها.",
      tone: "none",
    };
  const kicker = workspaceName ?? "مساحة العمل";
  if (loading)
    return { kicker, title: "جارٍ قراءة الخطة…", note: "", tone: "none" };
  if (failed)
    return {
      kicker,
      title: "تعذّرت قراءة الخطة",
      // Not "no plan": a failed read says nothing about the limit either way.
      note: "لا يعني ذلك نفاد الحد. حدّث الصفحة لإعادة المحاولة.",
      tone: "none",
    };
  if (!plan)
    return {
      kicker,
      title: "لا خطة مفعّلة",
      note: "يفعّل المشغّل الخطة يدويًا في هذه المرحلة.",
      tone: "none",
    };
  const analysis =
    plan.budgets.find((b) => b.event_type === "comment_analysis") ??
    plan.budgets[0];
  const tone = budgetState(analysis);
  // Western digits, as the report uses them.
  const n = (v: number) => v.toLocaleString("en-US");
  return {
    kicker,
    title: `خطة ${plan.plan_key}`,
    note:
      tone === "exhausted"
        ? `${budgetNames[analysis.event_type]}: نفد الحد (${n(analysis.allowance)})`
        : `${budgetNames[analysis.event_type]}: يتبقى ${n(analysis.remaining)} من ${n(analysis.allowance)}`,
    tone,
  };
}
