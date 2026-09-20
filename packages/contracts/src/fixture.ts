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

export const DashboardAggregatesSchema = z.object({
  workspace_total: z.number().int(),
  channel_own_comments: z.number().int(),
  total: z.number().int(),
  analysed: z.number().int(),
  unanalysed: z.number().int(),
  sentiments: z.object({
    positive: z.number().int(),
    negative: z.number().int(),
    neutral: z.number().int(),
    mixed: z.number().int(),
  }),
  measurable: z.array(z.string()),
  negative_ranked: z.number().int(),
  negative_unranked: z.number().int(),
  timeline: z.record(z.string(), z.number().int()),
  topic_counts: z.record(z.string(), z.number().int()),
  videos: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
      total: z.number().int(),
      analysed: z.number().int(),
      replies: z.number().int(),
      sentiments: z.object({
        positive: z.number().int(),
        negative: z.number().int(),
        neutral: z.number().int(),
        mixed: z.number().int(),
      }),
    }),
  ),
  hours: z.array(z.number().int()),
  weekdays: z.array(z.number().int()),
  weeks: z.array(
    z.object({
      week: z.string(),
      count: z.number().int(),
    }),
  ),
  people: z.array(
    z.object({
      name: z.string(),
      channel_id: z.string().nullable(),
      comments_count: z.number().int(),
      likes_count: z.number().int(),
    }),
  ),
  most_engaged_negative: z.array(
    z.object({
      id: z.string(),
      video_id: z.string().nullable(),
      video_title: z.string().nullable(),
      text_raw: z.string(),
      author_name: z.string().nullable(),
      published_at: z.string().nullable(),
      likes_value: z.number().nullable(),
      label: z.string().nullable(),
      topic: z.string().nullable(),
    }),
  ),
  comment_types: z.array(z.string()),
  video_options: z.array(
    z.object({
      id: z.string(),
      title: z.string().nullable(),
    }),
  ),
  topics: z.array(TopicSchema).default([]),
  active_analysis_key: z.string().nullable(),
  active_topic_key: z.string().nullable(),
  revision: z.string().nullable(),
});

export type DashboardAggregates = z.infer<typeof DashboardAggregatesSchema>;

export const DashboardCommentsResponseSchema = z.object({
  total: z.number().int(),
  comments: z.array(CommentSchema),
  limit: z.number().int(),
  offset: z.number().int(),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export type DashboardCommentsResponse = z.infer<
  typeof DashboardCommentsResponseSchema
>;
