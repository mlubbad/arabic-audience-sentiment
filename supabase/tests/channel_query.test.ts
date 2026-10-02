/**
 * What a channel lookup was asked for, parsed — the table of forms a channel
 * is named by in the wild. Pure: no network, no database.
 */
import { describe, expect, it } from "vitest";
import { parseChannelQuery } from "../functions/_shared/channel-query";

describe("parseChannelQuery", () => {
  it("names a channel by its UC id, bare or in a URL", () => {
    const id = "UCTPIL6f7yNpK8yc-H3cEtFg";
    expect(parseChannelQuery(id)).toEqual({ kind: "id", value: id });
    expect(parseChannelQuery(`https://www.youtube.com/channel/${id}/`)).toEqual(
      { kind: "id", value: id },
    );
  });

  it("names a channel by its handle, bare or in a URL", () => {
    expect(parseChannelQuery("@alaa_jaber_official")).toEqual({
      kind: "handle",
      value: "alaa_jaber_official",
    });
    expect(
      parseChannelQuery("https://youtube.com/@alaa_jaber_official"),
    ).toEqual({ kind: "handle", value: "alaa_jaber_official" });
    // Handles are not only Latin.
    expect(parseChannelQuery("@قناة.123")).toEqual({
      kind: "handle",
      value: "قناة.123",
    });
  });

  it("reads a legacy /user/ URL by username, and searches a /c/ vanity", () => {
    expect(parseChannelQuery("https://www.youtube.com/user/SomeName")).toEqual({
      kind: "username",
      value: "SomeName",
    });
    expect(parseChannelQuery("youtube.com/c/VanityName")).toEqual({
      kind: "search",
      value: "VanityName",
    });
  });

  it("searches plain words, trimmed", () => {
    expect(parseChannelQuery("  علاء جابر  ")).toEqual({
      kind: "search",
      value: "علاء جابر",
    });
    // Single-word names must search, not parse as fake URL hostnames
    expect(parseChannelQuery("Asharqnews")).toEqual({
      kind: "search",
      value: "Asharqnews",
    });
    expect(parseChannelQuery("AlJazeera")).toEqual({
      kind: "search",
      value: "AlJazeera",
    });
    expect(parseChannelQuery("BBC")).toEqual({
      kind: "search",
      value: "BBC",
    });
  });

  it("refuses what cannot name a channel", () => {
    // A video link is a channel nobody meant; so is another site's URL,
    // the empty string, and a handle-shaped id fragment.
    expect(
      parseChannelQuery("https://www.youtube.com/watch?v=DGA2hlrwB8g"),
    ).toBeNull();
    expect(parseChannelQuery("https://example.com/@someone")).toBeNull();
    expect(parseChannelQuery("example.com/@someone")).toBeNull();
    expect(parseChannelQuery("")).toBeNull();
    expect(parseChannelQuery("   ")).toBeNull();
    expect(parseChannelQuery("@ab")).toBeNull(); // handles run 3–30
    // A URL that is YouTube but names no channel is not a search either.
    expect(parseChannelQuery("https://www.youtube.com/")).toBeNull();
  });

  it("never mistakes a bare UC id for a URL host", () => {
    // `https://` + an id parses as a URL; the id check comes first.
    const id = `UC${"c".repeat(22)}`;
    expect(parseChannelQuery(id)).toEqual({ kind: "id", value: id });
  });
});
