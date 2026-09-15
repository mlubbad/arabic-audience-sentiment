/** The one filter contract every view, export and query must obey. */
import { z } from "zod";
import { LabelSchema, timestamp } from "./primitives";

export const FiltersSchema = z
  .object({
    workspace_id: z.string().uuid(),
    client_id: z.string().optional(),
    channel_id: z.string().optional(),
    video_ids: z.array(z.string()).max(100).default([]),
    video_kind: z.enum(["video", "short", "stream"]).optional(),
    from: timestamp.optional(),
    to: timestamp.optional(),
    date_mode: z.enum(["all", "known", "unknown"]).default("all"),
    sentiments: z.array(LabelSchema).default([]),
    // Topic keys, or UNCLASSIFIED for rows with no effective topic.
    topics: z.array(z.string().max(40)).max(50).default([]),
    comment_type: z.string().optional(),
    replies: z.enum(["all", "comments", "replies"]).default("all"),
    review_status: z.enum(["all", "reviewed", "unreviewed"]).default("all"),
    q: z.string().max(500).default(""),
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().optional(),
  })
  .strict()
  .refine(
    (v) => !v.from || !v.to || Date.parse(v.from) < Date.parse(v.to),
    "from must precede to",
  );
export type Filters = z.input<typeof FiltersSchema>;
