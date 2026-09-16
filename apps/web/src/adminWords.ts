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
 * purpose is printed by name. `forbidden` gets its own sentence; the two
 * argument refusals (`unknown_plan`, `invalid_months`) are named inside a
 * generic one; anything else shows PostgREST's code and never its text,
 * which can quote the request URL, and the URL carries a key.
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

/** The internal plans, which the catalogue leaves out on purpose: the owner's
 *  own workspaces and a pilot handed to someone before they pay. */
export const INTERNAL_PLAN_KEYS = ["owner", "pilot"] as const;

/** The two kinds of units a pack can carry. */
export const PACK_KINDS = ["comment_analysis", "topic_classification"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const MONTHS_MIN = 1;
export const MONTHS_MAX = 1200;

const NONE = "—";

export function adminRows(list: AdminWorkspace[], S: Strings): AdminRow[] {
  return list.map((w) => ({
    id: w.id,
    name: w.name,
    plan: w.plan_key ?? S.adminNoPlan,
    status: w.status ?? NONE,
    // The day, in Western digits, as the plan panel writes it.
    periodEnd: w.period_end?.slice(0, 10) ?? NONE,
    provider: w.provider ?? NONE,
  }));
}

/** The catalogue's keys in its order, then the internal ones, each once. */
export function adminPlanKeys(catalogue: { key: string }[]): string[] {
  const keys = catalogue.map((p) => p.key);
  for (const k of INTERNAL_PLAN_KEYS) if (!keys.includes(k)) keys.push(k);
  return keys;
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
  const code =
    typeof e.message === "string" && KNOWN.has(e.message)
      ? e.message
      : typeof e.code === "string" && e.code
        ? e.code
        : "unknown_error";
  return S.adminFailed(code);
}
