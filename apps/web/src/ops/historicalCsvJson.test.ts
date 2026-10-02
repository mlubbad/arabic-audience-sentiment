import { describe, expect, it } from "vitest";
import {
  generateDeterministicCommentId,
  generateSampleCsvTemplate,
  parseCsvRows,
  parseHistoricalCsv,
  parseHistoricalFile,
  parseHistoricalJson,
} from "./historicalCsvJson";

describe("generateDeterministicCommentId", () => {
  it("varies both 32-bit halves for different same-length ASCII inputs", () => {
    const first = generateDeterministicCommentId(
      "video",
      "author",
      "2026-10-02T00:00:00Z",
      0,
      "alpha",
    ).slice(-16);
    const second = generateDeterministicCommentId(
      "video",
      "author",
      "2026-10-02T00:00:00Z",
      0,
      "bravo",
    ).slice(-16);

    expect(first.slice(0, 8)).not.toBe(second.slice(0, 8));
    expect(first.slice(8)).not.toBe(second.slice(8));
  });

  it("is deterministic and emits a versioned 64-bit hex ID", () => {
    const args = [
      "video",
      "author",
      "2026-10-02T00:00:00Z",
      7,
      "ASCII comment",
    ] as const;

    const first = generateDeterministicCommentId(...args);
    const second = generateDeterministicCommentId(...args);

    expect(first).toBe(second);
    expect(first).toMatch(/^imp2_[0-9a-f]{16}$/);
  });
});

describe("parseCsvRows RFC 4180 parsing", () => {
  it("splits simple comma-separated lines", () => {
    const csv = "a,b,c\n1,2,3";
    expect(parseCsvRows(csv)).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas and line breaks", () => {
    const csv = 'id,text\n1,"Hello, world!"\n2,"Line 1\nLine 2"';
    const rows = parseCsvRows(csv);
    expect(rows).toEqual([
      ["id", "text"],
      ["1", "Hello, world!"],
      ["2", "Line 1\nLine 2"],
    ]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    const csv = 'id,quote\n1,"He said ""great""."';
    const rows = parseCsvRows(csv);
    expect(rows).toEqual([
      ["id", "quote"],
      ["1", 'He said "great".'],
    ]);
  });

  it("treats quote mid-unquoted-field as literal per RFC 4180", () => {
    const csv = 'id,text\n1,He said "great" yesterday\n2,Normal text';
    const rows = parseCsvRows(csv);
    expect(rows[1][1]).toBe('He said "great" yesterday');
  });

  it("detects delimiter once from the header without splitting on embedded delimiters", () => {
    const csv =
      "video_id;text;author\nv1;Hello, my friend;Omar\nv2;Another, test, comma;Fatima";
    const rows = parseCsvRows(csv);
    expect(rows).toEqual([
      ["video_id", "text", "author"],
      ["v1", "Hello, my friend", "Omar"],
      ["v2", "Another, test, comma", "Fatima"],
    ]);
  });
});

describe("parseHistoricalCsv", () => {
  it("parses CSV with English columns and auto-extracts posts and comments", () => {
    const csv = [
      "external_video_id,external_comment_id,text_raw,published_at,author_display_name,likes_raw",
      "v1,c1,Great video,2026-03-01T10:00:00Z,Ahmed,10",
      "v1,c2,Another helpful comment,2026-03-01T11:00:00Z,Fatima,5",
      "v2,c3,Interesting discussion,2026-03-02T12:00:00Z,Omar,0",
    ].join("\n");

    const res = parseHistoricalCsv(csv);
    expect(res.ok).toBe(true);
    expect(res.summary?.postsCount).toBe(2);
    expect(res.summary?.commentsCount).toBe(3);
    expect(res.payload?.comments[0].text_raw).toBe("Great video");
    expect(res.payload?.comments[0].author_name).toBe("Ahmed");
    expect(res.payload?.comments[0].likes_value).toBe(10);
    expect(res.payload?.posts).toHaveLength(2);
  });

  it("supports Arabic column names", () => {
    const csv = [
      "معرف_الفيديو,معرف_التعليق,نص_التعليق,تاريخ_النشر,صاحب_التعليق,الإعجابات",
      "v100,c100,شرح ممتاز ومفيد جدا,2026-03-15T12:00:00Z,محمد,25",
    ].join("\n");

    const res = parseHistoricalCsv(csv);
    expect(res.ok).toBe(true);
    expect(res.summary?.postsCount).toBe(1);
    expect(res.summary?.commentsCount).toBe(1);
    expect(res.payload?.comments[0].text_raw).toBe("شرح ممتاز ومفيد جدا");
    expect(res.payload?.comments[0].author_name).toBe("محمد");
    expect(res.payload?.comments[0].likes_value).toBe(25);
  });

  it("handles posts-only CSV files", () => {
    const csv = [
      "video_id,title,published_at",
      "v1,Episode 1: Introduction,2026-01-01T10:00:00Z",
      "v2,Episode 2: Deep Dive,2026-01-08T10:00:00Z",
    ].join("\n");

    const res = parseHistoricalCsv(csv);
    expect(res.ok).toBe(true);
    expect(res.summary?.postsCount).toBe(2);
    expect(res.summary?.commentsCount).toBe(0);
    expect(res.payload?.posts[0].title).toBe("Episode 1: Introduction");
  });

  it("returns error for invalid CSV or missing text column", () => {
    const csv = "some_random_column,another_col\nval1,val2";
    const res = parseHistoricalCsv(csv);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("missing_text_column");
  });

  it("keeps missing published_at date as null (never now())", () => {
    const csv = "video_id,comment_id,text\nv1,c1,Comment without date";
    const res = parseHistoricalCsv(csv);
    expect(res.ok).toBe(true);
    expect(res.payload?.comments[0].published_at).toBeNull();
  });

  it("keeps missing likes as null (never 0)", () => {
    const csv = "video_id,comment_id,text\nv1,c1,Comment without likes";
    const res = parseHistoricalCsv(csv);
    expect(res.ok).toBe(true);
    expect(res.payload?.comments[0].likes_value).toBeNull();
  });

  it("generates deterministic comment IDs for identical rows across re-imports", () => {
    const csv =
      "video_id,text,author\nv1,Helpful video,Ali\nv1,Helpful video,Ali";
    const res1 = parseHistoricalCsv(csv);
    const res2 = parseHistoricalCsv(csv);
    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(res1.payload?.comments[0].external_comment_id).toBe(
      res2.payload?.comments[0].external_comment_id,
    );
    expect(res1.payload?.comments[0].external_comment_id).toMatch(
      /^imp2_[0-9a-f]{16}$/,
    );
    expect(res1.payload?.comments[0].external_comment_id).not.toBe(
      res1.payload?.comments[1].external_comment_id,
    );
  });

  it("enforces 1,000 comment row limit", () => {
    const header = "video_id,comment_id,text\n";
    const rows = Array.from(
      { length: 1001 },
      (_, i) => `v1,c${i},Text ${i}`,
    ).join("\n");
    const res = parseHistoricalCsv(header + rows);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("batch_too_large");
  });
});

describe("parseHistoricalJson", () => {
  it("parses structured payload object with posts and comments", () => {
    const json = JSON.stringify({
      posts: [
        {
          external_video_id: "v1",
          title: "Video One",
          published_at: "2026-02-01T00:00:00Z",
        },
      ],
      comments: [
        {
          external_comment_id: "c1",
          external_video_id: "v1",
          text_raw: "Awesome video!",
          author_display_name: "Yousef",
        },
      ],
    });

    const res = parseHistoricalJson(json);
    expect(res.ok).toBe(true);
    expect(res.summary?.postsCount).toBe(1);
    expect(res.summary?.commentsCount).toBe(1);
    expect(res.payload?.comments[0].text_raw).toBe("Awesome video!");
  });

  it("parses direct array of comments", () => {
    const json = JSON.stringify([
      { comment_id: "c1", video_id: "v1", text: "Very nice", author: "Huda" },
      { comment_id: "c2", video_id: "v1", text: "Great work", author: "Ali" },
    ]);

    const res = parseHistoricalJson(json);
    expect(res.ok).toBe(true);
    expect(res.summary?.postsCount).toBe(1);
    expect(res.summary?.commentsCount).toBe(2);
    expect(res.payload?.comments[0].author_name).toBe("Huda");
  });

  it("returns error on invalid JSON", () => {
    const res = parseHistoricalJson("{ invalid json }");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("invalid_json");
  });

  it("keeps missing dates and likes as null in JSON", () => {
    const json = JSON.stringify([
      { video_id: "v1", text: "No date, no likes" },
    ]);
    const res = parseHistoricalJson(json);
    expect(res.ok).toBe(true);
    expect(res.payload?.comments[0].published_at).toBeNull();
    expect(res.payload?.comments[0].likes_value).toBeNull();
  });

  it("generates deterministic IDs for JSON comments without id", () => {
    const json = JSON.stringify([
      { video_id: "v1", text: "First comment" },
      { video_id: "v1", text: "Second comment" },
    ]);
    const res1 = parseHistoricalJson(json);
    const res2 = parseHistoricalJson(json);
    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(res1.payload?.comments[0].external_comment_id).toBe(
      res2.payload?.comments[0].external_comment_id,
    );
    expect(res1.payload?.comments[0].external_comment_id).toMatch(
      /^imp2_[0-9a-f]{16}$/,
    );
    expect(res1.payload?.comments[0].external_comment_id).not.toBe(
      res1.payload?.comments[1].external_comment_id,
    );
  });

  it("enforces 1,000 comment row limit on JSON", () => {
    const comments = Array.from({ length: 1001 }, (_, i) => ({
      video_id: "v1",
      text: `Comment ${i}`,
    }));
    const res = parseHistoricalJson(JSON.stringify(comments));
    expect(res.ok).toBe(false);
    expect(res.error).toBe("batch_too_large");
  });
});

describe("parseHistoricalFile and generateSampleCsvTemplate", () => {
  it("selects CSV parser for .csv extension", () => {
    const csv = "video_id,comment_id,text\nv1,c1,Hello";
    const res = parseHistoricalFile(csv, "data.csv");
    expect(res.ok).toBe(true);
    expect(res.summary?.commentsCount).toBe(1);
  });

  it("selects JSON parser for .json extension", () => {
    const json = JSON.stringify([{ text: "Testing JSON", video_id: "v1" }]);
    const res = parseHistoricalFile(json, "data.json");
    expect(res.ok).toBe(true);
    expect(res.summary?.commentsCount).toBe(1);
  });

  it("generates a valid sample CSV template that can be parsed", () => {
    const template = generateSampleCsvTemplate();
    const res = parseHistoricalCsv(template);
    expect(res.ok).toBe(true);
    expect(res.summary?.commentsCount).toBe(3);
  });

  it("rejects file exceeding 5MB limit", () => {
    // 5MB + 1 byte
    const largeContent = "a".repeat(5 * 1024 * 1024 + 1);
    const res = parseHistoricalFile(largeContent, "huge.csv");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("file_too_large");
  });
});
