import { describe, expect, it } from "vitest";
import {
  generateSampleCsvTemplate,
  parseCsvRows,
  parseHistoricalCsv,
  parseHistoricalFile,
  parseHistoricalJson,
} from "./historicalCsvJson";

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
});
