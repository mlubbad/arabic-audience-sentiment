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
import { TopicSchema } from "./topics";
import { UsageSummarySchema } from "./usage";
import { SyncStateSchema } from "./sync";

const dashboardData = {
  revision: z.string(),
  active_analysis_key: z.string(),
  // Which labels the active analysis can actually produce, taken from the
  // class scores its predictions carry. A three-class model has no Mixed, and
  // reporting "Mixed: 0" for it presents a missing capability as a
  // measurement of none — on this channel roughly one comment in twenty is
  // genuinely mixed, so the zero is not merely uninformative, it is wrong.
  // Empty means nothing has been analysed and therefore nothing is known.
  active_analysis_labels: z.array(z.string()).default([]),
  // The workspace's topic taxonomy and the key whose verdicts are effective.
  // Empty means no topic classification has run; the card says so.
  topics: z.array(TopicSchema).default([]),
  active_topic_key: z.string().default(""),
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
