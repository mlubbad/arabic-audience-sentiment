// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import type { ChannelCandidate } from "@sentiment/contracts";
import { parseImportFile } from "./channelImport";
import {
  EMPTY_SESSION,
  importCounts,
  importReducer,
  loadSaved,
  nextImport,
  nextLookup,
  save,
  type ImportAction,
  type ImportSession,
} from "./channelImportState";

const cand = (id: string, title: string): ChannelCandidate => ({
  external_channel_id: id,
  handle: null,
  title,
  thumbnail_url: null,
  platform: "youtube",
});
const A = "UCAAAAAAAAAAAAAAAAAAAAA1";
const WS = "20000000-0000-4000-8000-000000000001";

function run(...actions: ImportAction[]): ImportSession {
  return actions.reduce(
    importReducer,
    importReducer(EMPTY_SESSION, {
      type: "load",
      fileName: "f.csv",
      parsed: parseImportFile("name\nAlpha\nBeta\nGamma"),
    }),
  );
}

afterEach(() => localStorage.clear());

describe("importReducer", () => {
  it("halts at a quota refusal, leaves the row waiting, and resumes from it", () => {
    let s = run(
      { type: "lookupDone", index: 1, candidates: [cand(A, "Alpha")] },
      { type: "lookupFailed", index: 2, code: "quota_exceeded" },
    );
    expect(s.quotaHalted).toBe(true);
    expect(nextLookup(s)).toBeNull();
    expect(s.rows[1]!.lookup).toEqual({ state: "idle" });
    s = importReducer(s, { type: "resume" });
    expect(nextLookup(s)?.entry.index).toBe(2);
  });

  it("puts a non-quota lookup failure back to wait on resume", () => {
    let s = run({ type: "lookupFailed", index: 1, code: "http_500" });
    expect(s.quotaHalted).toBe(false);
    expect(nextLookup(s)?.entry.index).toBe(2);
    s = importReducer(s, { type: "resume" });
    expect(nextLookup(s)?.entry.index).toBe(1);
  });

  it("imports only rows whose choice is a candidate it was offered", () => {
    let s = run(
      { type: "lookupDone", index: 1, candidates: [cand(A, "Alpha")] },
      { type: "lookupDone", index: 2, candidates: [cand("UCx", "Other")] },
      { type: "lookupDone", index: 3, candidates: [] },
    );
    // Alpha proposed itself; Beta waits; Gamma found nothing.
    expect(importCounts(s)).toMatchObject({
      lookedUp: 3,
      confirmed: 1,
      undecided: 1,
      notFound: 1,
    });
    expect(nextImport(s)?.entry.index).toBe(1);
    s = importReducer(s, { type: "choose", index: 2, choice: "skip" });
    s = importReducer(s, {
      type: "importDone",
      index: 1,
      result: {
        status: "exists",
        workspace_id: WS,
        workspace_name: "Home",
      },
    });
    expect(nextImport(s)).toBeNull();
    expect(importCounts(s)).toMatchObject({ skipped: 1, existing: 1 });
    // A settled row's choice no longer moves.
    s = importReducer(s, { type: "choose", index: 1, choice: "skip" });
    expect(s.rows[0]!.choice).toBe(A);
  });

  it("retries a failed import only when asked", () => {
    let s = run(
      { type: "lookupDone", index: 1, candidates: [cand(A, "Alpha")] },
      { type: "importFailed", index: 1, code: "no_active_plan" },
    );
    expect(nextImport(s)).toBeNull();
    s = importReducer(s, { type: "retryImport", index: 1 });
    expect(nextImport(s)?.entry.index).toBe(1);
  });
});

describe("saved session", () => {
  it("comes back with in-flight work waiting again", () => {
    save(
      run(
        { type: "lookupStart", index: 1 },
        { type: "lookupDone", index: 2, candidates: [cand(A, "Beta")] },
        { type: "choose", index: 2, choice: A },
        { type: "importStart", index: 2 },
      ),
    );
    const s = loadSaved();
    expect(s.rows[0]!.lookup).toEqual({ state: "idle" });
    expect(s.rows[1]!.outcome).toEqual({ state: "idle" });
    expect(s.rows[1]!.choice).toBe(A);
  });

  it("forgets an empty session and survives garbage", () => {
    save(EMPTY_SESSION);
    expect(localStorage.length).toBe(0);
    localStorage.setItem("admin-channel-import:v1", "{not json");
    expect(loadSaved()).toEqual(EMPTY_SESSION);
  });
});
