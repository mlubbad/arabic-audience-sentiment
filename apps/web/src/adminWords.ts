/**
 * What the admin page says and accepts, decided away from the page.
 *
 * The page is the operator's own screen: every workspace, the plan it is on,
 * and the two hand levers the handoff describes — set a plan for some months,
 * grant a pack of units. This module turns an `admin_workspaces()` row into
 * the strings a table row prints, lists the keys a plan `<select>` offers,
 * checks the two numbers before they are sent, and chooses the sentence for
 * a refusal.
 *
 * Refusals follow `authMessages.ts`: only a code this application raises on
 * purpose is printed by name. `forbidden` and `paddle_subscription_active`
 * get their own sentences; the two argument refusals (`unknown_plan`,
 * `invalid_months`) are named inside a generic one; anything else shows
 * PostgREST's code and never its text, which can quote the request URL, and
 * the URL carries a key.
 */
import type { AdminWorkspace } from "@sentiment/contracts";
import type { Strings } from "./strings";

export type AdminRow = {
  id: string;
  name: string;
  plan: string;
  status: string;
  periodEnd: string;
  provider: string;
};

/** The two kinds of units a pack can carry. */
export const PACK_KINDS = ["comment_analysis", "topic_classification"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const MONTHS_MIN = 1;
export const MONTHS_MAX = 1200;

const NONE = "—";

/** A workspace row as the table prints it: the plan by its name (from the
 *  catalogue, when given), the status and provider in words, and a period
 *  that does not end shown as such rather than as a date a century out
 *  (owner console review, 2026-10-13, finding 17). An unknown code is shown
 *  as is rather than hidden. */
export function adminRows(
  list: AdminWorkspace[],
  S: Strings,
  plans: { key: string; label: string }[] = [],
): AdminRow[] {
  return list.map((w) => ({
    id: w.id,
    name: w.name,
    plan: w.plan_key
      ? (plans.find((p) => p.key === w.plan_key)?.label ?? w.plan_key)
      : S.adminNoPlan,
    status: w.status ? (S.adminStatusLabels[w.status] ?? w.status) : NONE,
    periodEnd: periodEndLabel(w.period_end, S),
    provider: w.provider
      ? (S.adminProviderLabels[w.provider] ?? w.provider)
      : NONE,
  }));
}

/** Fifty years out is no end: the free plan and hand activations of up to
 *  1,200 months are written a century ahead. */
const NO_END_YEARS = 50;

/** The day a period ends, in Western digits as the plan panel writes it;
 *  "no end date" for one that does not end. */
export function periodEndLabel(
  iso: string | null | undefined,
  S: Strings,
  now: Date = new Date(),
): string {
  if (!iso) return NONE;
  const year = Number(iso.slice(0, 4));
  if (year - now.getUTCFullYear() >= NO_END_YEARS) return S.adminNoEnd;
  return iso.slice(0, 10);
}

/** An audit action in words. Paddle's subscription events arrive as
 *  `plan_paddle_<event>`; anything still unnamed is shown as is. */
export function auditActionLabel(action: string, S: Strings): string {
  const named = S.adminAccountActions[action];
  if (named) return named;
  if (action.startsWith("plan_paddle_"))
    return S.adminAuditPaddlePlan(action.slice("plan_paddle_".length));
  return action;
}

/** Every plan the admin may set, named in the reader's language and keyed by
 *  the key the RPC takes. The rows come from `admin_plan_catalogue()`, which
 *  lists internal plans too — the public catalogue never does. */
export function adminPlanOptions(
  plans: { key: string; title_ar: string; title_en: string }[],
  locale: "ar" | "en",
): { key: string; label: string }[] {
  return plans.map((p) => ({
    key: p.key,
    label: locale === "ar" ? p.title_ar : p.title_en,
  }));
}

/** A whole number of months in the range `set_workspace_plan` accepts, or
 *  null: the database refuses the same range, but a refusal after a round
 *  trip is worse than a button that waits. */
export function adminMonths(value: string): number | null {
  const n = whole(value);
  return n !== null && n >= MONTHS_MIN && n <= MONTHS_MAX ? n : null;
}

/** A whole number of units above zero, or null. */
export function adminUnits(value: string): number | null {
  const n = whole(value);
  return n !== null && n > 0 ? n : null;
}

function whole(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/** Refusals this application raises on purpose, safe to name on screen:
 *  `set_workspace_plan`'s two argument checks, and `grant_units`' refusal to
 *  attach a pack to a workspace that has no plan for it to sit on. */
const KNOWN = new Set(["unknown_plan", "invalid_months", "no_active_plan"]);

export function adminErrorMessage(error: unknown, S: Strings): string {
  const e = (error ?? {}) as { message?: unknown; code?: unknown };
  if (e.message === "forbidden") return S.adminForbidden;
  // set_workspace_plan over a root Paddle is billing, without override.
  if (e.message === "paddle_subscription_active") return S.adminPaddleActive;
  if (e.message === "billing_root") return S.adminDeleteBillingRoot;
  if (e.message === "last_workspace") return S.adminDeleteLast;
  const code =
    typeof e.message === "string" && KNOWN.has(e.message)
      ? e.message
      : typeof e.code === "string" && e.code
        ? e.code
        : "unknown_error";
  return S.adminFailed(code);
}

const SAFE_DATABASE_CODE = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/;

/** A write that did not happen, in one sentence: the page's own words for
 *  what failed, then the database's code when it sent a safe one (`42501`
 *  refused, `23514` a limit out of range). Never the error's text, which
 *  for these calls is always `live_unavailable`. */
export function adminWriteFailure(sentence: string, error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && SAFE_DATABASE_CODE.test(code)
    ? `${sentence} (${code})`
    : sentence;
}
