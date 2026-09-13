import { z } from "zod";

export const LabelSchema = z.enum(["positive", "negative", "neutral", "mixed"]);
export type Label = z.infer<typeof LabelSchema>;
const timestamp = z.string().datetime({ offset: true });
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
export const PredictionSchema = z
  .object({
    status: z.enum(["succeeded", "skipped", "failed", "unsupported"]),
    label: LabelSchema.nullable(),
    content_hash: z.string().min(1),
    analysis_key: z.string().min(1),
    model_id: z.string().min(1),
    revision: z.string().min(1),
    preprocessing_version: z.string().min(1),
    predicted_at: timestamp,
    class_scores: z.record(LabelSchema, z.number().min(0).max(1)),
  })
  .strict()
  .refine(
    (v) => (v.status === "succeeded" ? v.label !== null : v.label === null),
    "Only successful predictions have labels",
  );
export const ReviewSchema = z.object({
  label: LabelSchema,
  content_hash: z.string(),
  created_at: timestamp,
  origin: z.enum(["human", "legacy_unverified"]),
});
export const CommentSchema = z
  .object({
    id: z.string().min(1),
    workspace_id: z.string().uuid(),
    client_id: z.string(),
    channel_id: z.string(),
    video_id: z.string(),
    video_kind: z.enum(["video", "short", "stream"]),
    author_channel_id: z.string().nullable(),
    author_name: z.string(),
    text_raw: z.string(),
    content_hash: z.string().min(1),
    published_at: timestamp.nullable(),
    published_time_raw: z.string().nullable(),
    timestamp_precision: z.enum([
      "second",
      "minute",
      "day",
      "approximate",
      "unknown",
    ]),
    is_reply: z.boolean(),
    parent_comment_id: z.string().nullable(),
    parent_source: z.enum(["api", "extractor", "inferred_id", "unknown"]),
    source: z.enum([
      "sanitized_fixture",
      "youtube_data_api_public",
      "youtube_public_scrape",
      "youtube_oauth",
      "legacy_import",
    ]),
    field_provenance: z.record(z.unknown()),
    comment_type: z.string().nullable(),
    prediction: PredictionSchema.nullable(),
    reviews: z.array(ReviewSchema),
  })
  .strict();
export type Comment = z.infer<typeof CommentSchema>;
export const JobSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  channel_id: z.string().uuid(),
  type: z.enum(["discover", "collect", "analyse", "import", "export"]),
  dedupe_key: z.string().min(1).max(200),
  status: z.enum([
    "queued",
    "running",
    "succeeded",
    "partial",
    "failed",
    "blocked",
    "cancelled",
  ]),
  attempt: z.number().int().nonnegative(),
  not_before: timestamp,
  lease_expires_at: timestamp.nullable(),
  checkpoint: z.record(z.unknown()),
  counters: z.record(z.number().int().nonnegative()),
  error_code: z.string().nullable(),
}); // Public job DTO deliberately excludes lease tokens and credentials.
export const ErrorSchema = z.object({
  code: z.enum([
    "invalid_input",
    "unauthenticated",
    "forbidden",
    "conflict",
    "unsupported_import",
    "quota_exceeded",
    "worker_unavailable",
  ]),
  message: z.string(),
  request_id: z.string().uuid(),
  retryable: z.boolean(),
});
export const CommentReviewInputSchema = z
  .object({
    workspace_id: z.string().uuid(),
    comment_id: z.string().min(1),
    // The hash of the text the reviewer actually read. Optimistic concurrency:
    // a verdict is only valid for the version it was formed against.
    content_hash: z.string().min(1),
    label: LabelSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export type CommentReviewInput = z.infer<typeof CommentReviewInputSchema>;

/**
 * Appends a human correction. Pure and non-mutating, so a rejected correction
 * cannot leave a half-applied list behind. The server RPC enforces the same
 * rules; this is the shared reference implementation, not a substitute for it.
 */
export function applyReview(
  comments: Comment[],
  raw: CommentReviewInput,
  now: string,
): Comment[] {
  const input = CommentReviewInputSchema.parse(raw);
  const target = comments.find(
    (c) => c.id === input.comment_id && c.workspace_id === input.workspace_id,
  );
  if (!target) throw new Error("invalid_comment");
  if (target.content_hash !== input.content_hash)
    throw new Error("stale_comment_text");
  const review = {
    label: input.label,
    content_hash: input.content_hash,
    created_at: now,
    origin: "human" as const,
  };
  return comments.map((c) =>
    c === target ? { ...c, reviews: [...c.reviews, review] } : c,
  );
}

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

export const FixtureSchema = z.object({
  mode: z.literal("sanitized_fixture"),
  revision: z.string(),
  active_analysis_key: z.string(),
  // Null means no plan has been activated, which the UI must say plainly.
  plan: UsageSummarySchema.nullable(),
  comments: z.array(CommentSchema),
});

export function effectiveLabel(
  comment: Comment,
  activeKey: string,
): { label: Label | null; reviewed: boolean } {
  const review = comment.reviews
    .filter(
      (r) => r.origin === "human" && r.content_hash === comment.content_hash,
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (review) return { label: review.label, reviewed: true };
  const p = comment.prediction;
  return {
    label:
      p?.status === "succeeded" &&
      p.content_hash === comment.content_hash &&
      p.analysis_key === activeKey
        ? p.label
        : null,
    reviewed: false,
  };
}

export type LabelledComment = Comment & {
  label: Label | null;
  reviewed: boolean;
};

/**
 * The single filter implementation. Views and exports both go through it, so an
 * export can never be a differently filtered version of what was on screen.
 */
function filteredRows(
  input: Comment[],
  f: z.output<typeof FiltersSchema>,
  activeKey: string,
): LabelledComment[] {
  const unique = new Map(
    input
      .filter((c) => c.workspace_id === f.workspace_id)
      .map((c) => [c.id, c]),
  );
  return [...unique.values()]
    .map((c) => ({ ...c, ...effectiveLabel(c, activeKey) }))
    .filter((c) => {
      if (
        (f.client_id && c.client_id !== f.client_id) ||
        (f.channel_id && c.channel_id !== f.channel_id)
      )
        return false;
      if (
        (f.video_ids.length && !f.video_ids.includes(c.video_id)) ||
        (f.video_kind && c.video_kind !== f.video_kind)
      )
        return false;
      if (
        (f.date_mode === "unknown" && c.published_at !== null) ||
        (f.date_mode === "known" && c.published_at === null)
      )
        return false;
      if (f.from || f.to) {
        if (!c.published_at) return false;
        const t = Date.parse(c.published_at);
        if (
          (f.from && t < Date.parse(f.from)) ||
          (f.to && t >= Date.parse(f.to))
        )
          return false;
      }
      if (f.sentiments.length && (!c.label || !f.sentiments.includes(c.label)))
        return false;
      if (f.comment_type && c.comment_type !== f.comment_type) return false;
      if (
        (f.replies === "comments" && c.is_reply) ||
        (f.replies === "replies" && !c.is_reply)
      )
        return false;
      if (
        (f.review_status === "reviewed" && !c.reviewed) ||
        (f.review_status === "unreviewed" && c.reviewed)
      )
        return false;
      return `${c.text_raw} ${c.author_name} ${c.author_channel_id ?? ""}`
        .toLocaleLowerCase()
        .includes(f.q.trim().toLocaleLowerCase());
    })
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
}

/**
 * Every row the filters select, never a page of them. An export that silently
 * stopped at the page size would understate the answer it claims to give.
 */
export function exportRows(
  input: Comment[],
  raw: Filters,
  activeKey: string,
): LabelledComment[] {
  return filteredRows(input, FiltersSchema.parse(raw), activeKey);
}

/** Pure fixture/reference implementation. Server queries must separately enforce RLS. */
export function snapshot(input: Comment[], raw: Filters, activeKey: string) {
  const f = FiltersSchema.parse(raw);
  const rows = filteredRows(input, f, activeKey);
  const sentiments: Record<Label, number> = {
    positive: 0,
    negative: 0,
    neutral: 0,
    mixed: 0,
  };
  const videos = new Map<string, number>(),
    timeline = new Map<string, number>();
  for (const c of rows) {
    if (c.label) sentiments[c.label]++;
    videos.set(c.video_id, (videos.get(c.video_id) ?? 0) + 1);
    const day = c.published_at
      ? new Date(c.published_at).toISOString().slice(0, 10)
      : "unknown";
    timeline.set(day, (timeline.get(day) ?? 0) + 1);
  }
  const analysed = Object.values(sentiments).reduce((a, b) => a + b, 0);
  const cursorIndex = f.cursor ? rows.findIndex((c) => c.id === f.cursor) : -1;
  if (f.cursor && cursorIndex < 0) throw new Error("invalid_cursor");
  const comments = rows.slice(cursorIndex + 1, cursorIndex + 1 + f.limit);
  return {
    mode: "sanitized_fixture" as const,
    total: rows.length,
    analysed,
    unanalysed: rows.length - analysed,
    sentiments,
    replies: rows.filter((c) => c.is_reply).length,
    unknown_dates: rows.filter((c) => !c.published_at).length,
    unique_authors: new Set(
      rows.flatMap((c) => (c.author_channel_id ? [c.author_channel_id] : [])),
    ).size,
    videos: [...videos].map(([id, total]) => ({ id, total })),
    timeline: [...timeline].map(([date, total]) => ({ date, total })),
    comments,
    next_cursor:
      cursorIndex + 1 + comments.length < rows.length
        ? comments.at(-1)!.id
        : null,
  };
}

export const CSV_COLUMNS = [
  "comment_id",
  "video_id",
  "video_kind",
  "author_name",
  "author_channel_id",
  "text_raw",
  "effective_label",
  "label_source",
  "prediction_status",
  "analysis_key",
  "published_at",
  "published_time_raw",
  "timestamp_precision",
  "is_reply",
  "parent_comment_id",
  "parent_source",
  "source",
  "content_hash",
] as const;

// A cell a spreadsheet would evaluate on open rather than display.
const FORMULA_START = /^[=+\-@\t\r]/;

function escapeCell(value: string): string {
  // Neutralising happens on the way out only. The stored text is evidence and
  // is never rewritten to make a spreadsheet safe.
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  return guarded !== value || /["\n\r,]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}

function labelSource(row: LabelledComment): string {
  if (row.reviewed) return "human_review";
  return row.label ? "model" : "none";
}

/**
 * Renders already-filtered rows. Takes the output of exportRows so the file and
 * the dashboard cannot disagree about which comments are in scope.
 */
export function toCsv(rows: LabelledComment[]): string {
  const body = rows.map((r) =>
    [
      r.id,
      r.video_id,
      r.video_kind,
      r.author_name,
      r.author_channel_id ?? "",
      r.text_raw,
      r.label ?? "",
      labelSource(r),
      r.prediction?.status ?? "",
      r.prediction?.analysis_key ?? "",
      r.published_at ?? "",
      r.published_time_raw ?? "",
      r.timestamp_precision,
      String(r.is_reply),
      r.parent_comment_id ?? "",
      r.parent_source,
      r.source,
      r.content_hash,
    ]
      .map(escapeCell)
      .join(","),
  );
  // The byte order mark is what makes Excel read the file as UTF-8 rather than
  // mangling Arabic into a legacy code page.
  return `\uFEFF${[CSV_COLUMNS.join(","), ...body].join("\r\n")}\r\n`;
}

/**
 * Storage object path for an export. The first segment is the workspace id
 * because that is exactly what the private bucket policy checks.
 */
export function exportObjectPath(workspaceId: string, now: Date): string {
  return `${workspaceId}/comments-${now.toISOString().slice(0, 10)}.csv`;
}
