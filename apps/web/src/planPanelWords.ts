/**
 * What the account's plan panel says, decided away from the panel.
 *
 * The rail card answers one question — can I start a collection — with one
 * figure. The account page is where the plan is managed, so it carries the
 * whole of `usage_summary`: the plan's title, when it renews, every budget
 * against its ceiling, what is about to happen to it (a payment that could
 * not be collected, a cancellation that takes effect at period end), and
 * which doors are open. The doors follow from the row, not from the reader:
 *
 * - `manage` when Paddle holds the subscription — the portal is the only
 *   place a card or a cancellation can be changed;
 * - `upgrade` when the plan is self-serve but not Paddle's — free, or set by
 *   hand — so the next step is the pricing page;
 * - `topup` when any budget has a ceiling a pack could raise;
 * - `contact` for a business plan, whose next tier is a conversation;
 * - nothing at all for an internal plan, which has no ceiling and no bill.
 *
 * Dates are ISO days in Western digits, as the report writes them; the
 * past-due day is period end plus the seven days the meter keeps counting.
 */
import {
  budgetState,
  unlimited,
  type UsageSummary,
} from "@sentiment/contracts";
import type { Strings } from "./strings";

export type PlanAction = "upgrade" | "manage" | "topup" | "contact";

export type PlanPanelRow = {
  label: string;
  used: string;
  allowance: string;
  tone: "ok" | "warning" | "critical" | "exhausted";
};

export type PlanPanelWords = {
  title: string;
  statusLine: string;
  rows: PlanPanelRow[];
  actions: PlanAction[];
  notice: string | null;
};

/** How long the meter keeps counting after a payment fails, in days. */
export const PAST_DUE_GRACE_DAYS = 7;

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` of an ISO instant, moved by whole days. */
export const isoDay = (iso: string, plusDays = 0) =>
  new Date(new Date(iso).getTime() + plusDays * DAY_MS)
    .toISOString()
    .slice(0, 10);

export function planPanelWords(
  summary: UsageSummary | null,
  S: Strings,
  locale: "ar" | "en",
): PlanPanelWords {
  if (!summary || !summary.plan)
    return {
      title: S.planNoneTitle,
      statusLine: S.planNoneNote,
      rows: [],
      actions: [],
      notice: null,
    };
  const p = summary.plan;
  // Western digits, as the report uses them; -1 is a ceiling that is not there.
  const n = (v: number) =>
    v === -1 ? S.pricingUnlimited : v.toLocaleString("en-US");
  const rows = summary.budgets.map((b) => ({
    label:
      b.event_type === "comment_analysis"
        ? S.budgetAnalysis
        : b.event_type === "topic_classification"
          ? S.budgetTopics
          : S.budgetBackfill,
    used: n(b.used),
    allowance: n(b.allowance),
    tone: unlimited(b) ? ("ok" as const) : budgetState(b),
  }));
  const actions: PlanAction[] = [];
  if (p.segment !== "internal") {
    if (summary.provider === "paddle") actions.push("manage");
    else if (p.self_serve) actions.push("upgrade");
    if (summary.budgets.some((b) => !unlimited(b))) actions.push("topup");
    if (p.segment === "business") actions.push("contact");
  }
  const notice =
    summary.status === "past_due"
      ? S.planPastDue(isoDay(summary.period_end, PAST_DUE_GRACE_DAYS))
      : summary.cancel_at_period_end
        ? S.planEndsOn(isoDay(summary.period_end))
        : null;
  return {
    title: locale === "ar" ? p.title_ar : p.title_en,
    statusLine:
      summary.status === "past_due"
        ? S.planStatusPastDue
        : S.planRenews(isoDay(summary.period_end)),
    rows,
    actions,
    notice,
  };
}
