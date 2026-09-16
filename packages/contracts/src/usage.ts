/** Plan limits and metering as shown to a workspace. */
import { z } from "zod";
import { timestamp } from "./primitives";

export const BudgetSchema = z
  .object({
    event_type: z.enum([
      "comment_analysis",
      "historical_backfill",
      "topic_classification",
    ]),
    used: z.number().int().nonnegative(),
    /** -1 means no ceiling (an internal plan). */
    allowance: z.number().int().min(-1),
    /** What add-on packs contributed to the allowance; already inside it. */
    granted: z.number().int().nonnegative().default(0),
    remaining: z.number().int().min(-1),
  })
  .strict()
  .refine(
    (b) =>
      b.allowance === -1
        ? b.remaining === -1
        : b.remaining === Math.max(b.allowance - b.used, 0),
    "remaining must follow from used and allowance",
  );
export const UsageSummarySchema = z
  .object({
    plan_key: z.string().min(1),
    status: z.enum(["active", "paused", "cancelled"]),
    period_start: timestamp,
    period_end: timestamp,
    budgets: z.array(BudgetSchema).min(1),
  })
  .strict();
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
export type Budget = z.infer<typeof BudgetSchema>;
/** An internal plan with no ceiling: nothing to warn about, ever. */
export const unlimited = (b: Budget) => b.allowance === -1;

/**
 * Applies the 70% / 85% alert thresholds the specification uses for the storage
 * budget to plan usage as well, so a limit is visible while there is still room
 * to act. A zero allowance is exhausted rather than a division by zero, and
 * an unlimited one is always ok.
 */
export function budgetState(
  b: Budget,
): "ok" | "warning" | "critical" | "exhausted" {
  if (unlimited(b)) return "ok";
  if (b.allowance === 0 || b.used >= b.allowance) return "exhausted";
  const share = b.used / b.allowance;
  if (share >= 0.85) return "critical";
  return share >= 0.7 ? "warning" : "ok";
}
