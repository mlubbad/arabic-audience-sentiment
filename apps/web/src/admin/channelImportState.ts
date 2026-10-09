/**
 * The bulk import's working state: one row per channel of the file, from
 * lookup through the owner's choice to the import's verdict.
 *
 * A reducer, so the page is a loop over `nextLookup` / `nextImport` and every
 * transition is tested without a server. The state is kept in the browser
 * between visits (`loadSaved` / `save`) because each search spends a hundred
 * units of a daily YouTube quota: closing the tab must not spend them twice.
 */
import type { AdminImportResult, ChannelCandidate } from "@sentiment/contracts";
import {
  proposedCandidate,
  type ImportEntry,
  type ParsedImport,
} from "./channelImport";

export type LookupState =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "done"; candidates: ChannelCandidate[] }
  | { state: "failed"; code: string };

export type ImportState =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "done"; result: AdminImportResult }
  | { state: "failed"; code: string };

export type ImportRow = {
  entry: ImportEntry;
  lookup: LookupState;
  /** The chosen channel's id, `skip`, or null while undecided. */
  choice: string | "skip" | null;
  outcome: ImportState;
};

export type ImportSession = {
  fileName: string;
  rows: ImportRow[];
  duplicates: number;
  rejected: string[];
  /** Set when YouTube says the day's quota is spent: lookups stop there. */
  quotaHalted: boolean;
};

export type ImportAction =
  | { type: "load"; fileName: string; parsed: ParsedImport }
  | { type: "reset" }
  | { type: "lookupStart"; index: number }
  | { type: "lookupDone"; index: number; candidates: ChannelCandidate[] }
  | { type: "lookupFailed"; index: number; code: string }
  | { type: "resume" }
  | { type: "choose"; index: number; choice: string | "skip" }
  | { type: "importStart"; index: number }
  | { type: "importDone"; index: number; result: AdminImportResult }
  | { type: "importFailed"; index: number; code: string }
  | { type: "retryImport"; index: number };

export const EMPTY_SESSION: ImportSession = {
  fileName: "",
  rows: [],
  duplicates: 0,
  rejected: [],
  quotaHalted: false,
};

function patch(
  s: ImportSession,
  index: number,
  f: (row: ImportRow) => ImportRow,
): ImportSession {
  return {
    ...s,
    rows: s.rows.map((r) => (r.entry.index === index ? f(r) : r)),
  };
}

export function importReducer(
  s: ImportSession,
  a: ImportAction,
): ImportSession {
  switch (a.type) {
    case "load":
      return {
        fileName: a.fileName,
        rows: a.parsed.entries.map((entry) => ({
          entry,
          lookup: { state: "idle" },
          choice: null,
          outcome: { state: "idle" },
        })),
        duplicates: a.parsed.duplicates,
        rejected: a.parsed.rejected,
        quotaHalted: false,
      };
    case "reset":
      return EMPTY_SESSION;
    case "lookupStart":
      return patch(s, a.index, (r) => ({ ...r, lookup: { state: "pending" } }));
    case "lookupDone":
      return patch(s, a.index, (r) => {
        const proposed = proposedCandidate(r.entry, a.candidates);
        return {
          ...r,
          lookup: { state: "done", candidates: a.candidates },
          choice: proposed ? proposed.external_channel_id : r.choice,
        };
      });
    case "lookupFailed": {
      const next = patch(s, a.index, (r) => ({
        ...r,
        // A quota refusal is not this row's failure: it waits for tomorrow.
        lookup:
          a.code === "quota_exceeded"
            ? { state: "idle" }
            : { state: "failed", code: a.code },
      }));
      return a.code === "quota_exceeded"
        ? { ...next, quotaHalted: true }
        : next;
    }
    case "resume":
      return {
        ...s,
        quotaHalted: false,
        rows: s.rows.map((r) =>
          r.lookup.state === "failed" ? { ...r, lookup: { state: "idle" } } : r,
        ),
      };
    case "choose":
      return patch(s, a.index, (r) =>
        r.outcome.state === "done" ? r : { ...r, choice: a.choice },
      );
    case "importStart":
      return patch(s, a.index, (r) => ({
        ...r,
        outcome: { state: "pending" },
      }));
    case "importDone":
      return patch(s, a.index, (r) => ({
        ...r,
        outcome: { state: "done", result: a.result },
      }));
    case "importFailed":
      return patch(s, a.index, (r) => ({
        ...r,
        outcome: { state: "failed", code: a.code },
      }));
    case "retryImport":
      return patch(s, a.index, (r) =>
        r.outcome.state === "failed" ? { ...r, outcome: { state: "idle" } } : r,
      );
  }
}

/** The next row to look up, or null when every row has an answer (or the
 *  day's quota stopped the run). */
export function nextLookup(s: ImportSession): ImportRow | null {
  if (s.quotaHalted) return null;
  return s.rows.find((r) => r.lookup.state === "idle") ?? null;
}

/** The chosen candidate of a row, when the choice names one it was offered. */
export function chosenCandidate(row: ImportRow): ChannelCandidate | null {
  if (row.lookup.state !== "done" || !row.choice || row.choice === "skip")
    return null;
  return (
    row.lookup.candidates.find((c) => c.external_channel_id === row.choice) ??
    null
  );
}

/** The next confirmed row still to import. */
export function nextImport(s: ImportSession): ImportRow | null {
  return (
    s.rows.find(
      (r) => r.outcome.state === "idle" && chosenCandidate(r) !== null,
    ) ?? null
  );
}

export type ImportCounts = {
  total: number;
  lookedUp: number;
  notFound: number;
  undecided: number;
  confirmed: number;
  skipped: number;
  created: number;
  existing: number;
  failed: number;
};

export function importCounts(s: ImportSession): ImportCounts {
  const c: ImportCounts = {
    total: s.rows.length,
    lookedUp: 0,
    notFound: 0,
    undecided: 0,
    confirmed: 0,
    skipped: 0,
    created: 0,
    existing: 0,
    failed: 0,
  };
  for (const r of s.rows) {
    if (r.lookup.state === "done") {
      c.lookedUp++;
      if (!r.lookup.candidates.length) c.notFound++;
      else if (r.choice === null) c.undecided++;
    }
    if (r.choice === "skip") c.skipped++;
    else if (chosenCandidate(r) && r.outcome.state !== "done") c.confirmed++;
    if (r.outcome.state === "done") {
      if (r.outcome.result.status === "created") c.created++;
      else c.existing++;
    }
    if (r.outcome.state === "failed") c.failed++;
  }
  return c;
}

const STORE_KEY = "admin-channel-import:v1";

/** The saved session, with work that was in flight put back to wait: a
 *  pending lookup or import whose answer never arrived is asked again. A
 *  pending import may have landed before the tab closed; asking again is
 *  safe because the import answers a channel it already holds with `exists`. */
export function loadSaved(): ImportSession {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    if (!raw) return EMPTY_SESSION;
    const s = JSON.parse(raw) as ImportSession;
    if (!s || !Array.isArray(s.rows)) return EMPTY_SESSION;
    return {
      ...EMPTY_SESSION,
      ...s,
      rows: s.rows.map((r) => ({
        ...r,
        lookup: r.lookup.state === "pending" ? { state: "idle" } : r.lookup,
        outcome: r.outcome.state === "pending" ? { state: "idle" } : r.outcome,
      })),
    };
  } catch {
    return EMPTY_SESSION;
  }
}

export function save(s: ImportSession): void {
  try {
    if (!s.rows.length) globalThis.localStorage?.removeItem(STORE_KEY);
    else globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* Remembering is a convenience; failing to remember is not an error. */
  }
}
