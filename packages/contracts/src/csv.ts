/** CSV rendering of an already-filtered read. */
import { type LabelledComment } from "./snapshot";

export const CSV_COLUMNS = [
  "comment_id",
  "video_id",
  "video_kind",
  "author_name",
  "author_channel_id",
  "text_raw",
  "content_purged_at",
  "effective_label",
  "label_source",
  "prediction_status",
  "analysis_key",
  "effective_topic",
  "topic_source",
  "classification_key",
  "published_at",
  "published_time_raw",
  "timestamp_precision",
  "is_reply",
  "parent_comment_id",
  "parent_source",
  "source",
  "content_hash",
  "likes_raw",
  "likes_value",
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

function topicSource(row: LabelledComment): string {
  if (row.topic_reviewed) return "human_review";
  return row.topic ? "model" : "none";
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
      r.author_name ?? "",
      r.author_channel_id ?? "",
      // An empty cell would read as a comment with no text. This one had text
      // and no longer does, which is a different fact and belongs in the file.
      r.text_raw ??
        (r.content_purged_at ? "[نص محذوف بموجب مدة الاحتفاظ]" : ""),
      r.content_purged_at ?? "",
      r.label ?? "",
      labelSource(r),
      r.prediction?.status ?? "",
      r.prediction?.analysis_key ?? "",
      // The key, not the display name: a rename must not change what an old
      // file says.
      r.topic ?? "",
      topicSource(r),
      r.topic_prediction?.classification_key ?? "",
      r.published_at ?? "",
      r.published_time_raw ?? "",
      r.timestamp_precision,
      String(r.is_reply),
      r.parent_comment_id ?? "",
      r.parent_source,
      r.source,
      r.content_hash,
      r.likes_raw ?? "",
      // Empty means unknown, never zero.
      r.likes_value === null ? "" : String(r.likes_value),
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
