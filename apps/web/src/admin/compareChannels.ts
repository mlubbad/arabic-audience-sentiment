/**
 * The comparison page's choices, kept apart from the page so each is tested
 * without rendering: a channel's net sentiment and its change, which
 * channels are compared at all, the order, the three highlights, and the CSV.
 *
 * Net sentiment is the workspace dashboard's own (`dashboard_aggregates`):
 * (positive − negative) ÷ (positive + negative) × 100, neutral and mixed
 * left out. A net from a handful of comments says little, so a channel is
 * ranked only with `MIN_SAMPLE` positive-or-negative comments, and a weekly
 * change only when both weeks have that many; the rest are listed after the
 * ranked ones, marked as a small sample.
 *
 * The filter lives in the address (`?owner=&q=&sort=`), as on the channels
 * console.
 */
import type { AdminCompareChannel } from "@sentiment/contracts";
import { fold } from "./AdminCommandPalette";
import { csvCell, type OwnerFilter } from "./channelsConsole";

export const MIN_SAMPLE = 20;

export type CompareSort = "best" | "worst" | "volume" | "change" | "name";

export type CompareFilter = {
  owner: OwnerFilter;
  query: string;
  sort: CompareSort;
};

const SORTS: CompareSort[] = ["best", "worst", "volume", "change", "name"];
const OWNERS: OwnerFilter[] = ["all", "mine", "customers"];

export function readCompareFilter(params: URLSearchParams): CompareFilter {
  const owner = params.get("owner");
  const sort = params.get("sort");
  return {
    owner: OWNERS.find((o) => o === owner) ?? "all",
    query: params.get("q") ?? "",
    sort: SORTS.find((s) => s === sort) ?? "best",
  };
}

export function writeCompareFilter(f: CompareFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.owner !== "all") p.set("owner", f.owner);
  if (f.query.trim()) p.set("q", f.query);
  if (f.sort !== "best") p.set("sort", f.sort);
  return p;
}

/** Net sentiment in percent, one decimal; null with nothing to weigh. */
export function netSentiment(
  positive: number,
  negative: number,
): number | null {
  const polar = positive + negative;
  if (polar === 0) return null;
  return Math.round(((positive - negative) / polar) * 1000) / 10;
}

export type ComparedChannel = AdminCompareChannel & {
  name: string;
  net: number | null;
  /** Enough positive-or-negative comments to be ranked. */
  ranked: boolean;
  /** This week's net minus the week before's, in points; null when either
   *  week is too small to say. */
  change: number | null;
};

const enough = (w: { positive: number; negative: number }) =>
  w.positive + w.negative >= MIN_SAMPLE;

export function compared(c: AdminCompareChannel): ComparedChannel {
  const change =
    enough(c.week) && enough(c.previous_week)
      ? Math.round(
          (netSentiment(c.week.positive, c.week.negative)! -
            netSentiment(c.previous_week.positive, c.previous_week.negative)!) *
            10,
        ) / 10
      : null;
  return {
    ...c,
    name: c.title ?? c.handle ?? c.external_channel_id,
    net: netSentiment(c.positive, c.negative),
    ranked: enough(c),
    change,
  };
}

function matchesQuery(c: ComparedChannel, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(
    [c.title, c.handle, c.external_channel_id, c.workspace_name, c.owner_email]
      .filter(Boolean)
      .join(" "),
  );
  return words.every((w) => hay.includes(w));
}

const byName = (a: ComparedChannel, b: ComparedChannel) =>
  a.name.localeCompare(b.name);

/** What the page shows: kept by account and search, ranked channels first in
 *  the chosen order, then the small samples by volume. */
export function visibleCompare(
  rows: AdminCompareChannel[],
  f: CompareFilter,
): ComparedChannel[] {
  const kept = rows
    .map(compared)
    .filter(
      (c) =>
        (f.owner === "all" || (f.owner === "mine") === c.mine) &&
        matchesQuery(c, f.query),
    );
  if (f.sort === "name") return kept.sort(byName);
  if (f.sort === "volume")
    return kept.sort((a, b) => b.analysed - a.analysed || byName(a, b));
  const order: Record<
    "best" | "worst" | "change",
    (a: ComparedChannel, b: ComparedChannel) => number
  > = {
    best: (a, b) => b.net! - a.net!,
    worst: (a, b) => a.net! - b.net!,
    change: (a, b) =>
      (b.change === null ? -1 : Math.abs(b.change)) -
      (a.change === null ? -1 : Math.abs(a.change)),
  };
  const cmp = order[f.sort];
  const ranked = kept
    .filter((c) => c.ranked)
    .sort((a, b) => cmp(a, b) || byName(a, b));
  const small = kept
    .filter((c) => !c.ranked)
    .sort((a, b) => b.analysed - a.analysed || byName(a, b));
  return [...ranked, ...small];
}

/** The three cards: the warmest and the coldest audience among the ranked,
 *  and the biggest weekly change either way. */
export function highlights(rows: ComparedChannel[]): {
  best: ComparedChannel | null;
  worst: ComparedChannel | null;
  mover: ComparedChannel | null;
} {
  const ranked = rows.filter((c) => c.ranked);
  const pick = (
    list: ComparedChannel[],
    better: (a: ComparedChannel, b: ComparedChannel) => boolean,
  ) =>
    list.reduce<ComparedChannel | null>(
      (top, c) => (top === null || better(c, top) ? c : top),
      null,
    );
  return {
    best: pick(ranked, (a, b) => a.net! > b.net!),
    worst: pick(ranked, (a, b) => a.net! < b.net!),
    mover: pick(
      rows.filter((c) => c.change !== null && c.change !== 0),
      (a, b) => Math.abs(a.change!) > Math.abs(b.change!),
    ),
  };
}

const CSV_COLUMNS = [
  "rank",
  "name",
  "handle",
  "channel_id",
  "workspace",
  "owner",
  "copies",
  "analysed",
  "positive",
  "negative",
  "neutral",
  "mixed",
  "net_sentiment",
  "week_net",
  "previous_week_net",
  "change_points",
  "top_topic",
] as const;

/** The rows as shown, as a CSV file's text with a byte-order mark so a
 *  spreadsheet opens the Arabic names as Arabic. Small samples carry no
 *  rank. */
export function compareCsv(rows: ComparedChannel[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  let rank = 0;
  for (const c of rows)
    lines.push(
      [
        c.ranked ? ++rank : null,
        c.name,
        c.handle,
        c.external_channel_id,
        c.workspace_name,
        c.owner_email,
        c.copies,
        c.analysed,
        c.positive,
        c.negative,
        c.neutral,
        c.mixed,
        c.net,
        netSentiment(c.week.positive, c.week.negative),
        netSentiment(c.previous_week.positive, c.previous_week.negative),
        c.change,
        c.top_topic?.key ?? null,
      ]
        .map(csvCell)
        .join(","),
    );
  return "﻿" + lines.join("\r\n") + "\r\n";
}
