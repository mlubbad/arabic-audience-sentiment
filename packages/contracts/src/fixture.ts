/** Shape of the sanitized fixture the dashboard reads in fixture mode. */
import { z } from "zod";
import { CommentSchema } from "./comments";
import { UsageSummarySchema } from "./usage";
import { SyncStateSchema } from "./sync";

export const FixtureSchema = z.object({
  mode: z.literal("sanitized_fixture"),
  revision: z.string(),
  active_analysis_key: z.string(),
  // Null means no plan has been activated, which the UI must say plainly.
  plan: UsageSummarySchema.nullable(),
  // A malformed block falls back to null rather than failing the whole read.
  // Sync health is not load-bearing: an unreadable status must not take the
  // dashboard down, and null is classified as unknown rather than healthy.
  sync: SyncStateSchema.nullable().catch(null),
  comments: z.array(CommentSchema),
});
