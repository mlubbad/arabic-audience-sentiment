/** The ladder as plan_catalogue() returns it; -1 in a limit means no ceiling. */
import { z } from "zod";

export const PlanLimitsSchema = z
  .object({
    analysis_units: z.number().int().min(-1),
    topic_units: z.number().int().min(-1),
    insight_reports: z.number().int().nonnegative(),
    channels: z.number().int().min(-1),
    members: z.number().int().min(-1),
    workspaces: z.number().int().min(-1),
    live_interval_minutes: z.number().int().nonnegative(),
  })
  .strict();

export const PlanSchema = z
  .object({
    key: z.string().min(1),
    segment: z.enum(["individual", "business", "internal"]),
    title_ar: z.string(),
    title_en: z.string(),
    price_monthly_cents: z.number().int().nonnegative(),
    price_yearly_cents: z.number().int().nonnegative(),
    self_serve: z.boolean(),
    provider_prices: z.record(z.string()).default({}),
    limits: PlanLimitsSchema,
  })
  .strict();

export const PlanCatalogueSchema = z.array(PlanSchema);

export type Plan = z.infer<typeof PlanSchema>;
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;

/** The limits of a plan, or null when there is none to read yet. */
export function planLimits(plan: Plan | null | undefined): PlanLimits | null {
  return plan ? plan.limits : null;
}
