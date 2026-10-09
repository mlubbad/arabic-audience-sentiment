/**
 * The bulk import's file, read: which channels a CSV names, and how each one
 * will be looked up.
 *
 * Two layouts are read. The template: one channel per row under a header
 * with a `name` column and an optional `url` column. And the ranked lists
 * people actually paste from a spreadsheet: title rows, then one or more
 * side-by-side blocks headed "الترتيب, القناة, …" (rank, channel). Every
 * column headed as a channel name is read; a rank column just before it
 * orders the result. A cell that is already a link, a handle or a UC id is
 * looked up by that (one quota unit); anything else is a search (a hundred).
 *
 * Pure, so the layouts are tested without the page.
 */

export type ImportEntry = {
  /** 1-based position in the final list, after ranking and de-duplication. */
  index: number;
  /** The name the file gives, as the file spells it. */
  name: string;
  /** What `channel-lookup` is asked: the link when there is one, else the name. */
  query: string;
  /** `direct` names the channel (1 unit); `search` searches for it (100). */
  kind: "direct" | "search";
  rank: number | null;
};

export type ParsedImport = {
  entries: ImportEntry[];
  /** Rows the file names twice: kept once, counted here. */
  duplicates: number;
  /** Cells that look like a link but name no YouTube channel. */
  rejected: string[];
};

export const MAX_IMPORT_ROWS = 500;
export const SEARCH_UNITS = 100;
export const DIRECT_UNITS = 1;

const NAME_HEADERS = new Set([
  "name",
  "channel",
  "channel name",
  "القناة",
  "اسم القناة",
  "القناه",
]);
const URL_HEADERS = new Set([
  "url",
  "link",
  "channel url",
  "الرابط",
  "رابط القناة",
]);
const RANK_HEADERS = new Set(["rank", "#", "الترتيب", "المركز"]);

/** RFC 4180 rows: quoted cells may hold commas, quotes ("") and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

type Block = { name: number; url: number | null; rank: number | null };

/** The blocks a header row opens: one per name column. */
function headerBlocks(cells: string[]): Block[] | null {
  const heads = cells.map(norm);
  const names = heads.flatMap((h, i) => (NAME_HEADERS.has(h) ? [i] : []));
  if (!names.length) return null;
  return names.map((name, k) => {
    const end = names[k + 1] ?? heads.length;
    const start = k === 0 ? 0 : names[k - 1]! + 1;
    const url = heads.findIndex(
      (h, i) => i > name && i < end && URL_HEADERS.has(h),
    );
    const rankAt = heads.findIndex(
      (h, i) => i >= start && i < name && RANK_HEADERS.has(h),
    );
    return {
      name,
      url: url === -1 ? null : url,
      rank: rankAt === -1 ? null : rankAt,
    };
  });
}

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE = /^@[\p{L}\p{N}._-]{3,30}$/u;

/**
 * How `channel-lookup` will read a cell: `direct` (it names the channel — a
 * UC id, an @handle, a /channel/, /@ or /user/ link), `search` (words, or a
 * /c/ vanity link), or null (a link that names no YouTube channel, which the
 * lookup refuses). The function's own parser
 * (`supabase/functions/_shared/channel-query.ts`) is the authority; this is
 * its outline for pricing the lookups before any is made, and
 * `channelImport.test.ts` holds the two to the same answers.
 */
export function lookupKind(raw: string): ImportEntry["kind"] | null {
  const input = raw.trim();
  if (!input || input.length > 300) return null;
  if (CHANNEL_ID.test(input)) return "direct";
  if (input.startsWith("@")) return HANDLE.test(input) ? "direct" : null;
  const explicit = /^https?:\/\//i.test(input);
  const youtubePath = /^(?:www\.|m\.)?youtube\.com\//i.test(input);
  const domainLike = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/.*)?$/i.test(input);
  if (!explicit && !youtubePath && !domainLike) return "search";
  let url: URL;
  try {
    url = new URL(explicit ? input : `https://${input}`);
  } catch {
    return "search";
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
  if (/^\/channel\/UC[A-Za-z0-9_-]{22}\/?$/.test(url.pathname)) return "direct";
  const byHandle = url.pathname.match(/^\/@([^/?#]+)/);
  if (byHandle) {
    let value: string;
    try {
      value = decodeURIComponent(byHandle[1]!);
    } catch {
      return null;
    }
    return HANDLE.test(`@${value}`) ? "direct" : null;
  }
  if (/^\/user\/[^/?#]+/.test(url.pathname)) return "direct";
  if (/^\/c\/[^/?#]+/.test(url.pathname)) return "search";
  return null;
}

/** The query for one channel, and whether it names it or searches for it.
 *  Null when the cell is URL-shaped but names no YouTube channel. */
export function queryFor(
  name: string,
  url: string,
): { query: string; kind: ImportEntry["kind"] } | null {
  const raw = url.trim() || name.trim();
  const kind = lookupKind(raw);
  return kind ? { query: raw, kind } : null;
}

export function parseImportFile(text: string): ParsedImport {
  const rows = parseCsv(text);
  let blocks: Block[] | null = null;
  const found: {
    name: string;
    query: string;
    kind: ImportEntry["kind"];
    rank: number | null;
    order: number;
  }[] = [];
  const rejected: string[] = [];
  let order = 0;

  for (const cells of rows) {
    const opened = headerBlocks(cells);
    if (opened) {
      blocks = opened;
      continue;
    }
    if (!blocks) continue; // title rows before the first header
    for (const b of blocks) {
      const name = (cells[b.name] ?? "").trim();
      const url = b.url === null ? "" : (cells[b.url] ?? "").trim();
      if (!name && !url) continue;
      const q = queryFor(name, url);
      if (!q) {
        rejected.push(url || name);
        continue;
      }
      const rankCell = b.rank === null ? "" : (cells[b.rank] ?? "").trim();
      const rank = /^\d+$/.test(rankCell) ? Number(rankCell) : null;
      found.push({ name: name || url, ...q, rank, order: order++ });
    }
  }

  // Ranked lists read across their blocks (1, 26, 2, 27 …); put them back in
  // rank order. Unranked rows keep the file's order, after the ranked ones.
  found.sort((a, b) =>
    a.rank !== null && b.rank !== null
      ? a.rank - b.rank || a.order - b.order
      : a.rank !== null
        ? -1
        : b.rank !== null
          ? 1
          : a.order - b.order,
  );

  const seen = new Set<string>();
  let duplicates = 0;
  const entries: ImportEntry[] = [];
  for (const f of found) {
    const key = norm(f.query);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    if (entries.length >= MAX_IMPORT_ROWS) break;
    entries.push({
      index: entries.length + 1,
      name: f.name,
      query: f.query,
      kind: f.kind,
      rank: f.rank,
    });
  }
  return { entries, duplicates, rejected };
}

/** YouTube quota units the lookups will spend, before any is made. */
export function lookupUnits(entries: readonly ImportEntry[]): number {
  return entries.reduce(
    (n, e) => n + (e.kind === "search" ? SEARCH_UNITS : DIRECT_UNITS),
    0,
  );
}

/** The candidate to propose for a row, or null to leave it to the owner.
 *  A direct lookup names one channel, so its single answer is proposed. A
 *  search is proposed only when a result's title is the file's name, letter
 *  for letter apart from case and spacing: anything looser is a guess. */
export function proposedCandidate<
  C extends { title: string | null; handle: string | null },
>(entry: ImportEntry, candidates: readonly C[]): C | null {
  if (entry.kind === "direct")
    return candidates.length === 1 ? candidates[0]! : null;
  const want = norm(entry.name);
  const exact = candidates.filter(
    (c) =>
      (c.title !== null && norm(c.title) === want) ||
      (c.handle !== null && norm(c.handle.replace(/^@/, "")) === want),
  );
  return exact.length === 1 ? exact[0]! : null;
}
