import { describe, expect, it } from "vitest";
import {
  BENCHMARK_CSV_COLUMNS,
  SUGGESTION_CSV_COLUMNS,
  benchmarkCsv,
  benchmarkFilename,
  channelSlug,
  suggestionsCsv,
  suggestionsFilename,
} from "./exports";

describe("competitor CSV exports (WO-33)", () => {
  it("starts with UTF-8 BOM, uses CRLF, neutralises formulas, leaves nulls empty, and round-trips Arabic", () => {
    const csv = suggestionsCsv([
      {
        external_id: "UC2222222222222222222222",
        title: '=HYPERLINK("https://evil.test","قناة الجزيرة")',
        handle: "@aljazeera",
        sources: ["featured", "manual"],
        status: "tracked",
        subscriber_count: null,
        view_count: 500000,
        video_count: null,
        country: "QA",
        default_language: "ar",
        profile_observed_at: "2026-10-24T12:00:00Z",
        components: { content: 0.75, locale: 1, size: null },
        score: 0.833,
        tier: "direct",
        reasons: [
          { kind: "shared_topics", value: 3 },
          { kind: "same_language" },
        ],
      },
    ]);

    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    const rows = csv.slice(1, -2).split("\r\n");
    expect(rows[0]).toBe(SUGGESTION_CSV_COLUMNS.join(","));
    expect(rows[0]?.split(",")).toEqual([...SUGGESTION_CSV_COLUMNS]);

    const row = rows[1]!;
    // Formula neutralised with leading apostrophe and CSV-quoted
    expect(row).toContain(
      '"\'=HYPERLINK(""https://evil.test"",""قناة الجزيرة"")"',
    );
    // Stable semicolon-joined sources and reasons
    expect(row).toContain(",featured;manual,shared_topics:3;same_language,");
    // Null size_similarity, subscriber_count, and video_count are empty cells, never 0
    expect(row).toContain(",0.833,0.75,1,,,500000,,QA,ar,2026-10-24T12:00:00Z");

    // Byte-for-byte UTF-8 round-trip of Arabic title
    const bytes = new TextEncoder().encode(csv);
    expect(new TextDecoder().decode(bytes)).toContain("قناة الجزيرة");
  });

  it("orders benchmark series with own first, computes first_day/last_day from points, and keeps raw RPC figures", () => {
    const csv = benchmarkCsv({
      days: 30,
      series: [
        {
          kind: "competitor",
          external_id: "UC_COMP",
          title: "منافس بلا نقاط",
          points: [],
          kpis: {
            subscribers: null,
            views: null,
            subscribers_change: null,
            views_change: null,
            videos_per_week: null,
            views_per_video: null,
          },
        },
        {
          kind: "own",
          external_id: "UC_OWN",
          title: "قناتي الرسمية",
          points: [
            {
              day: "2026-10-20",
              subscriber_count: 1050,
              view_count: 50000,
              video_count: 10,
            },
            {
              day: "2026-10-01",
              subscriber_count: 1000,
              view_count: 45000,
              video_count: 9,
            },
          ],
          kpis: {
            subscribers: 1050,
            views: 50000,
            subscribers_change: 50,
            views_change: 5000,
            videos_per_week: 1.75,
            views_per_video: 5000.45,
          },
        },
      ],
    });

    const rows = csv.slice(1, -2).split("\r\n");
    expect(rows[0]).toBe(BENCHMARK_CSV_COLUMNS.join(","));
    // Own series first, with unrounded RPC figures and sorted first/last day
    expect(rows[1]).toBe(
      "own,UC_OWN,قناتي الرسمية,30,2026-10-01,2026-10-20,2,1050,50000,50,5000,1.75,5000.45",
    );
    // Competitor without points has empty first_day/last_day and points = 0, null KPIs empty
    expect(rows[2]).toBe("competitor,UC_COMP,منافس بلا نقاط,30,,,0,,,,,,");
  });

  it("builds filenames from handle (without @) or channel id and injected UTC clock", () => {
    const clock = new Date("2026-10-24T23:30:00Z");
    expect(channelSlug({ id: "UC123", handle: "@sky.develop/ar" })).toBe(
      "sky-develop-ar",
    );
    expect(channelSlug({ id: "UC_99", handle: null })).toBe("UC_99");
    expect(
      suggestionsFilename({ id: "UC123", handle: "@sky_dev" }, clock),
    ).toBe("competitors-sky_dev-2026-10-24.csv");
    expect(benchmarkFilename({ id: "UC123", handle: null }, 90, clock)).toBe(
      "benchmark-UC123-90d-2026-10-24.csv",
    );
  });
});
