import { describe, expect, it } from "vitest";
import { parseChannelQuery } from "../../../../supabase/functions/_shared/channel-query";
import {
  MAX_IMPORT_ROWS,
  lookupKind,
  lookupUnits,
  parseCsv,
  parseImportFile,
  proposedCandidate,
  type ImportEntry,
} from "./channelImport";

// The layout of the ranked list the owner pasted (2026-10-09): title rows,
// then two side-by-side blocks per section, ranks running down each block.
const RANKED = [
  "قائمة المئة الكبار,,,,,",
  "المراكز من 1 إلى 50,,,,,",
  "الترتيب,القناة,المشتركون بالمليون,الترتيب,القناة,المشتركون بالمليون",
  "1,shfa,56.4,26,Ossy Marwah I اوسي مروة,12.4",
  "2,AboFlah,50.1,27,حيدر علي | Haider Ali,12.3",
  "المراكز من 51 إلى 100,,,,,",
  "الترتيب,القناة,المشتركون بالمليون,الترتيب,القناة,المشتركون بالمليون",
  "51,يوميات حمدى ووفاء,9.67,76,Sara PopFit,7.63",
  "52,دروس أونلاين,9.66,77,برنس مصر,7.61",
].join("\n");

describe("parseCsv", () => {
  it("reads quoted cells with commas, doubled quotes and newlines", () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\r\nx,y')).toEqual([
      ["a", "b, c", 'say "hi"', "two\nlines"],
      ["x", "y"],
    ]);
  });

  it("drops a byte-order mark", () => {
    expect(parseCsv("﻿name\nA")).toEqual([["name"], ["A"]]);
  });
});

describe("parseImportFile", () => {
  it("reads the ranked side-by-side list in rank order, skipping titles and repeated headers", () => {
    const { entries, duplicates, rejected } = parseImportFile(RANKED);
    expect(entries.map((e) => [e.rank, e.name])).toEqual([
      [1, "shfa"],
      [2, "AboFlah"],
      [26, "Ossy Marwah I اوسي مروة"],
      [27, "حيدر علي | Haider Ali"],
      [51, "يوميات حمدى ووفاء"],
      [52, "دروس أونلاين"],
      [76, "Sara PopFit"],
      [77, "برنس مصر"],
    ]);
    expect(entries.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(entries.every((e) => e.kind === "search")).toBe(true);
    expect(duplicates).toBe(0);
    expect(rejected).toEqual([]);
  });

  it("reads the template: a link is looked up directly, a bare name is searched", () => {
    const { entries } = parseImportFile(
      [
        "name,url",
        "Abo Flah,https://www.youtube.com/@AboFlah",
        "Shfa,",
        '"Comma, Channel",UC1234567890123456789012',
      ].join("\n"),
    );
    expect(entries).toEqual([
      {
        index: 1,
        name: "Abo Flah",
        query: "https://www.youtube.com/@AboFlah",
        kind: "direct",
        rank: null,
      },
      { index: 2, name: "Shfa", query: "Shfa", kind: "search", rank: null },
      {
        index: 3,
        name: "Comma, Channel",
        query: "UC1234567890123456789012",
        kind: "direct",
        rank: null,
      },
    ]);
  });

  it("keeps a channel the file names twice once, and counts the repeat", () => {
    const { entries, duplicates } = parseImportFile(
      "name\nAboFlah\n  aboflah \nShfa",
    );
    expect(entries.map((e) => e.name)).toEqual(["AboFlah", "Shfa"]);
    expect(duplicates).toBe(1);
  });

  it("sets aside a link that names no YouTube channel instead of searching it", () => {
    const { entries, rejected } = parseImportFile(
      "name,url\nA,https://example.com/a\nB,https://www.youtube.com/watch?v=x",
    );
    expect(entries).toEqual([]);
    expect(rejected).toEqual([
      "https://example.com/a",
      "https://www.youtube.com/watch?v=x",
    ]);
  });

  it("reads nothing from a file without a channel-name header", () => {
    expect(parseImportFile("foo,bar\n1,2").entries).toEqual([]);
  });

  it("stops at the row cap", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 5 }, (_, i) => `C${i}`);
    expect(parseImportFile(["name", ...rows].join("\n")).entries).toHaveLength(
      MAX_IMPORT_ROWS,
    );
  });
});

describe("lookupKind", () => {
  // Held to the lookup function's own parser: what it searches is `search`,
  // what it names is `direct`, what it refuses is null.
  const CASES = [
    "UC1234567890123456789012",
    "@AboFlah",
    "@ab",
    "https://www.youtube.com/@AboFlah",
    "youtube.com/@AboFlah/videos",
    "https://youtube.com/channel/UC1234567890123456789012",
    "https://www.youtube.com/user/someone",
    "https://www.youtube.com/c/Vanity",
    "https://www.youtube.com/watch?v=abc",
    "https://example.com/x",
    "example.com",
    "Noor Stars",
    "هل تعلم؟",
    "Ossy Marwah I اوسي مروة",
    "",
  ];
  it.each(CASES)("agrees with channel-lookup on %j", (raw) => {
    const parsed = parseChannelQuery(raw);
    const expected = parsed
      ? parsed.kind === "search"
        ? "search"
        : "direct"
      : null;
    expect(lookupKind(raw)).toBe(expected);
  });
});

describe("lookupUnits", () => {
  it("prices a search at 100 units and a direct lookup at 1", () => {
    const e = (kind: ImportEntry["kind"]): ImportEntry => ({
      index: 1,
      name: "x",
      query: "x",
      kind,
      rank: null,
    });
    expect(lookupUnits([e("search"), e("search"), e("direct")])).toBe(201);
  });
});

describe("proposedCandidate", () => {
  const entry = (name: string, kind: ImportEntry["kind"]): ImportEntry => ({
    index: 1,
    name,
    query: name,
    kind,
    rank: null,
  });
  const c = (title: string | null, handle: string | null = null) => ({
    title,
    handle,
  });

  it("proposes a direct lookup's single answer", () => {
    expect(proposedCandidate(entry("@a", "direct"), [c("A")])).toEqual(c("A"));
  });

  it("proposes a search result only when its title or handle is the file's name", () => {
    expect(
      proposedCandidate(entry("Noor  Stars", "search"), [
        c("Noor Stars Kids"),
        c("noor stars"),
      ]),
    ).toEqual(c("noor stars"));
    expect(
      proposedCandidate(entry("AboFlah", "search"), [
        c("Abo Flah", "@AboFlah"),
      ]),
    ).toEqual(c("Abo Flah", "@AboFlah"));
  });

  it("proposes nothing when the match is loose or ambiguous", () => {
    expect(
      proposedCandidate(entry("Jomaa", "search"), [c("Jomaa TV"), c("JOMAA!")]),
    ).toBeNull();
    expect(
      proposedCandidate(entry("Jomaa", "search"), [c("Jomaa"), c("jomaa")]),
    ).toBeNull();
  });
});
