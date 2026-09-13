/** Shape of the sanitized fixture the dashboard reads in fixture mode. */
import { z } from "zod";
import { CommentSchema } from "./comments";
import { UsageSummarySchema } from "./usage";

export const FixtureSchema = z.object({
  mode: z.literal("sanitized_fixture"),
  revision: z.string(),
  active_analysis_key: z.string(),
  // Null means no plan has been activated, which the UI must say plainly.
  plan: UsageSummarySchema.nullable(),
  comments: z.array(CommentSchema),
});
