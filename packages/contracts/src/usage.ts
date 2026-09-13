/** Plan limits and metering as shown to a workspace. */
import { z } from "zod";
import { timestamp } from "./primitives";

export const BudgetSchema = z
  .object({
    event_type: z.enum(["comment_analysis", "historical_backfill"]),
    used: z.number().int().nonnegative(),
    allowance: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (b) => b.remaining === Math.max(b.allowance - b.used, 0),
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

/**
 * Applies the 70% / 85% alert thresholds the specification uses for the storage
 * budget to plan usage as well, so a limit is visible while there is still room
 * to act. A zero allowance is exhausted rather than a division by zero.
 */
export function budgetState(
  b: Budget,
): "ok" | "warning" | "critical" | "exhausted" {
  if (b.allowance === 0 || b.used >= b.allowance) return "exhausted";
  const share = b.used / b.allowance;
  if (share >= 0.85) return "critical";
  return share >= 0.7 ? "warning" : "ok";
}
