/**
 * The channels console's choices, kept apart from the page so each is tested
 * without rendering: which channels a filter keeps, the order they are shown
 * in, and how many sit in each state.
 *
 * The filter lives in the address (`?state=&owner=&q=&sort=`), so the home's
 * state counts can link straight to the channels in that state, and a view
 * the owner arrived at can be sent or bookmarked as it is.
 */
import type { AdminConsoleChannel, ChannelState } from "@sentiment/contracts";
import type { Strings } from "../strings";
import { fold } from "./AdminCommandPalette";

/** Trouble first: the order the home lists states in and the default sort. */
export const STATE_ORDER: ChannelState[] = [
  "failing",
  "stale",
  "waiting",
  "new",
  "cataloguing",
  "collecting",
  "healthy",
  "paused",
];

/** How each state reads: trouble, work to look at, work in progress, fine. */
export const STATE_TONE: Record<
  ChannelState,
  "danger" | "warning" | "neutral" | "success"
> = {
  failing: "danger",
  stale: "warning",
  waiting: "warning",
  new: "neutral",
  cataloguing: "neutral",
  collecting: "neutral",
  healthy: "success",
  paused: "neutral",
};

export type OwnerFilter = "all" | "mine" | "customers";
export type SortKey = "state" | "name" | "comments" | "oldest";

export type ConsoleFilter = {
  state: ChannelState | "all";
  owner: OwnerFilter;
  query: string;
  sort: SortKey;
};

const SORTS: SortKey[] = ["state", "name", "comments", "oldest"];
const OWNERS: OwnerFilter[] = ["all", "mine", "customers"];

/** The filter an address asks for; anything unknown falls back to the
 *  default rather than to an empty page. */
export function readFilter(params: URLSearchParams): ConsoleFilter {
  const state = params.get("state");
  const owner = params.get("owner");
  const sort = params.get("sort");
  return {
    state: STATE_ORDER.find((s) => s === state) ?? "all",
    owner: OWNERS.find((o) => o === owner) ?? "all",
    query: params.get("q") ?? "",
    sort: SORTS.find((s) => s === sort) ?? "state",
  };
}

/** The address for a filter: only what differs from the default is kept. */
export function writeFilter(f: ConsoleFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.state !== "all") p.set("state", f.state);
  if (f.owner !== "all") p.set("owner", f.owner);
  if (f.query.trim()) p.set("q", f.query);
  if (f.sort !== "state") p.set("sort", f.sort);
  return p;
}

export const channelName = (c: AdminConsoleChannel) =>
  c.title ?? c.handle ?? c.external_channel_id;

/** The name a page prints: an untitled channel says so beside its id rather
 *  than passing the bare id off as a name (owner console review, 2026-10-13,
 *  finding 17). The CSV keeps `channelName`, the raw value. */
export function channelLabel(
  c: {
    title: string | null;
    handle: string | null;
    external_channel_id: string;
  },
  S: Strings,
): string {
  return c.title ?? c.handle ?? S.adminUntitledChannel(c.external_channel_id);
}

function matchesQuery(c: AdminConsoleChannel, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(
    [c.title, c.handle, c.external_channel_id, c.workspace_name, c.owner_email]
      .filter(Boolean)
      .join(" "),
  );
  return words.every((w) => hay.includes(w));
}

/** The channels the owner and query keep, before the state is chosen: what
 *  the state counts are counted over. */
export function scoped(
  rows: AdminConsoleChannel[],
  f: Pick<ConsoleFilter, "owner" | "query">,
): AdminConsoleChannel[] {
  return rows.filter(
    (c) =>
      (f.owner === "all" || (f.owner === "mine") === c.mine) &&
      matchesQuery(c, f.query),
  );
}

export function stateCounts(
  rows: AdminConsoleChannel[],
): Record<ChannelState, number> {
  const counts = Object.fromEntries(STATE_ORDER.map((s) => [s, 0])) as Record<
    ChannelState,
    number
  >;
  for (const c of rows) counts[c.state]++;
  return counts;
}

const rank = (s: ChannelState) => STATE_ORDER.indexOf(s);
const okTime = (c: AdminConsoleChannel) =>
  c.last_ok_at ? Date.parse(c.last_ok_at) : -Infinity;

/** What the page shows: scoped, in the chosen state, in the chosen order. */
export function visibleChannels(
  rows: AdminConsoleChannel[],
  f: ConsoleFilter,
): AdminConsoleChannel[] {
  const kept = scoped(rows, f).filter(
    (c) => f.state === "all" || c.state === f.state,
  );
  const byName = (a: AdminConsoleChannel, b: AdminConsoleChannel) =>
    channelName(a).localeCompare(channelName(b));
  const order: Record<
    SortKey,
    (a: AdminConsoleChannel, b: AdminConsoleChannel) => number
  > = {
    state: (a, b) => rank(a.state) - rank(b.state) || byName(a, b),
    name: byName,
    comments: (a, b) => b.comments - a.comments || byName(a, b),
    oldest: (a, b) => okTime(a) - okTime(b) || byName(a, b),
  };
  return [...kept].sort(order[f.sort]);
}

const CSV_COLUMNS = [
  "name",
  "handle",
  "channel_id",
  "workspace",
  "owner",
  "state",
  "videos",
  "selected",
  "comments",
  "analysed",
  "last_good_collection",
  "last_error",
] as const;

export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  // A number is the database's own figure: written as is, so -12 stays a
  // number in the spreadsheet rather than the text '-12.
  if (typeof value === "number") return String(value);
  // Quote what would break a row; text that starts with = + - @, a tab or a
  // carriage return is neutralised so a spreadsheet never reads a channel
  // name as a formula (a leading tab or CR is skipped before the = is seen).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The channels as a CSV file's text, with a byte-order mark so a
 *  spreadsheet opens the Arabic names as Arabic. */
export function channelsCsv(rows: AdminConsoleChannel[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const c of rows)
    lines.push(
      [
        channelName(c),
        c.handle,
        c.external_channel_id,
        c.workspace_name,
        c.owner_email,
        c.state,
        c.videos,
        c.selected,
        c.comments,
        c.analysed,
        c.last_ok_at,
        c.last_error,
      ]
        .map(csvCell)
        .join(","),
    );
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}
