import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  exportObjectPath,
  exportRows,
  snapshot,
  toCsv,
  type Comment,
} from "./index";

const workspace = "00000000-0000-4000-8000-000000000001";
const base = {
  workspace_id: workspace,
  client_id: "client",
  channel_id: "channel",
  video_id: "v1",
  video_kind: "video" as const,
  author_channel_id: "author",
  author_name: "كاتب تجريبي",
  text_raw: "تعليق تجريبي",
  content_hash: "current",
  likes_raw: "0",
  likes_value: 0,
  published_at: "2026-09-01T00:00:00Z",
  published_time_raw: "2026-09-01T00:00:00Z",
  timestamp_precision: "second" as const,
  is_reply: false,
  parent_comment_id: null,
  parent_source: "unknown" as const,
  source: "sanitized_fixture" as const,
  field_provenance: {},
  comment_type: null,
  reviews: [],
  prediction: null,
};
const pred = (label: "positive" | "mixed", hash = "current") => ({
  status: "succeeded" as const,
  label,
  content_hash: hash,
  analysis_key: "fixture-v1",
  model_id: "sanitized-fixture",
  revision: "fixture-v1",
  preprocessing_version: "fixture-v1",
  predicted_at: "2026-09-02T00:00:00Z",
  class_scores: { positive: 0, negative: 0, neutral: 0, mixed: 0 },
});
const rows: Comment[] = [
  { ...base, id: "1", prediction: pred("positive") },
  { ...base, id: "2", video_id: "v2", prediction: pred("positive", "old") },
  {
    ...base,
    id: "3",
    prediction: pred("mixed"),
    reviews: [
      {
        label: "negative" as const,
        content_hash: "current",
        created_at: "2026-09-03T00:00:00Z",
        origin: "human" as const,
        reviewer_id: "reviewer-1",
        reason: "تصنيف خاطئ",
      },
    ],
  },
  { ...base, id: "4", workspace_id: "00000000-0000-4000-8000-000000000002" },
];
const lines = (csv: string) =>
  csv
    .replace(/^\uFEFF/, "")
    .trim()
    .split("\r\n");

describe("csv export", () => {
  it("exports exactly the rows the dashboard counted, ignoring the page size", () => {
    const filters = { workspace_id: workspace, limit: 1 };
    const view = snapshot(rows, filters, "fixture-v1");
    const exported = exportRows(rows, filters, "fixture-v1");
    expect(view.comments).toHaveLength(1);
    expect(exported).toHaveLength(view.total);
    expect(lines(toCsv(exported))).toHaveLength(view.total + 1);
  });

  it("applies the same filters as the dashboard, including search", () => {
    for (const filters of [
      { workspace_id: workspace, video_ids: ["v2"] },
      { workspace_id: workspace, q: "كاتب" },
      { workspace_id: workspace, sentiments: ["negative" as const] },
      { workspace_id: workspace, review_status: "reviewed" as const },
    ]) {
      expect(exportRows(rows, filters, "fixture-v1")).toHaveLength(
        snapshot(rows, filters, "fixture-v1").total,
      );
    }
  });

  it("never leaks another workspace", () => {
    expect(
      exportRows(rows, { workspace_id: workspace }, "fixture-v1").some(
        (r) => r.id === "4",
      ),
    ).toBe(false);
  });

  it("reports the effective label and where it came from", () => {
    const body = lines(
      toCsv(exportRows(rows, { workspace_id: workspace }, "fixture-v1")),
    );
    expect(body[0].split(",")).toEqual([...CSV_COLUMNS]);
    const cell = (id: string, column: string) => {
      const row = body.find((l) => l.startsWith(`${id},`))!.split(",");
      return row[CSV_COLUMNS.indexOf(column as (typeof CSV_COLUMNS)[number])];
    };
    expect(cell("1", "effective_label")).toBe("positive");
    expect(cell("1", "label_source")).toBe("model");
    // A human verdict overrules the model and is marked as such.
    expect(cell("3", "effective_label")).toBe("negative");
    expect(cell("3", "label_source")).toBe("human_review");
    // A prediction for older text is not a label, but its status is preserved.
    expect(cell("2", "effective_label")).toBe("");
    expect(cell("2", "label_source")).toBe("none");
    expect(cell("2", "prediction_status")).toBe("succeeded");
  });

  it("neutralises spreadsheet formulas without altering the stored text", () => {
    const attacks = [
      '=HYPERLINK("http://x","click")',
      "+1+1",
      "-1+1",
      "@SUM(A1)",
      "\tleading tab",
      "\rleading return",
    ];
    const malicious: Comment[] = attacks.map((text, i) => ({
      ...base,
      id: `a${i}`,
      text_raw: text,
      author_name: text,
    }));
    const snapshotOfInput = JSON.stringify(malicious);
    const body = lines(
      toCsv(exportRows(malicious, { workspace_id: workspace }, "fixture-v1")),
    ).slice(1);
    expect(body).toHaveLength(attacks.length);
    for (const line of body) {
      // Every dangerous cell is quoted and prefixed, so a spreadsheet reads it
      // as text rather than evaluating it.
      expect(line).toContain("\"'");
      expect(/,(=|\+|-|@|\t|\r)/.test(line)).toBe(false);
    }
    // The export is a rendering; it must not rewrite what is stored.
    expect(JSON.stringify(malicious)).toBe(snapshotOfInput);
    expect(malicious[0].text_raw).toBe(attacks[0]);
  });

  it("escapes quotes, commas and newlines so the row count stays honest", () => {
    const tricky: Comment[] = [
      {
        ...base,
        id: "q1",
        text_raw: 'يقول "مرحبا", ثم\nسطر ثانٍ',
      },
    ];
    const csv = toCsv(
      exportRows(tricky, { workspace_id: workspace }, "fixture-v1"),
    );
    expect(csv).toContain('"يقول ""مرحبا"", ثم\nسطر ثانٍ"');
    // The embedded newline is inside quotes, so it is not a record separator.
    expect(lines(csv)).toHaveLength(2);
  });

  it("starts with a byte order mark so Arabic opens correctly in Excel", () => {
    expect(
      toCsv(exportRows(rows, { workspace_id: workspace }, "fixture-v1")),
    ).toMatch(/^\uFEFF/);
  });

  it("names the object so the private bucket policy can scope it", () => {
    const path = exportObjectPath(workspace, new Date("2026-09-12T22:00:00Z"));
    // The policy reads split_part(name,'/',1), so the workspace must lead.
    expect(path.split("/")[0]).toBe(workspace);
    expect(path).toBe(`${workspace}/comments-2026-09-12.csv`);
  });
});
