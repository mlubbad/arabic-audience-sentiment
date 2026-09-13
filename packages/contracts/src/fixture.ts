/**
 * What the dashboard reads, in either mode.
 *
 * The field definitions are shared on purpose. The fixture is a file and the
 * live snapshot is assembled from the tables by `public.dashboard_snapshot`,
 * and both feed the same `snapshot()`; defining them separately is how the two
 * modes would start computing different figures from equivalent rows.
 */
import { z } from "zod";
import { CommentSchema } from "./comments";
import { UsageSummarySchema } from "./usage";
import { SyncStateSchema } from "./sync";

const dashboardData = {
  revision: z.string(),
  active_analysis_key: z.string(),
  // Null means no plan has been activated, which the UI must say plainly.
  plan: UsageSummarySchema.nullable(),
  // A malformed block falls back to null rather than failing the whole read.
  // Sync health is not load-bearing: an unreadable status must not take the
  // dashboard down, and null is classified as unknown rather than healthy.
  sync: SyncStateSchema.nullable().catch(null),
  comments: z.array(CommentSchema),
};

/** The sanitized fixture the dashboard reads in fixture mode. */
export const FixtureSchema = z.object({
  mode: z.literal("sanitized_fixture"),
  ...dashboardData,
});

/** The same shape, assembled from the database for a real workspace. */
export const LiveSnapshotSchema = z.object({
  mode: z.literal("live"),
  ...dashboardData,
});

export type Fixture = z.infer<typeof FixtureSchema>;
export type LiveSnapshot = z.infer<typeof LiveSnapshotSchema>;
