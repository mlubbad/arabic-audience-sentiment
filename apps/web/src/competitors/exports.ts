/**
 * CSV builders and filename generators for competitor suggestions and
 * performance benchmarks (WO-33).
 *
 * Rules:
 * - UTF-8 with BOM (`\ufeff`) and CRLF (`\r\n`) line endings;
 * - `csvCell` neutralises formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`);
 * - unknown values are empty cells (`""`), never `0`;
 * - header keys carry provenance (`_youtube`, `_our_estimate`, `_our_calculation`).
 */
import type { CompetitorBenchmark, Suggestions } from "../api/competitors";
import { csvCell } from "../csv";

export const SUGGESTION_CSV_COLUMNS = [
  "candidate_external_id",
  "title",
  "handle",
  "status",
  "tier",
  "sources",
  "reasons",
  "score_our_estimate",
  "content_similarity_our_estimate",
  "locale_similarity_our_estimate",
  "size_similarity_our_estimate",
  "subscriber_count_youtube",
  "view_count_youtube",
  "video_count_youtube",
  "country_youtube",
  "default_language_youtube",
  "profile_observed_at",
] as const;

export const BENCHMARK_CSV_COLUMNS = [
  "kind",
  "external_id",
  "title",
  "window_days",
  "first_day",
  "last_day",
  "points",
  "subscribers_youtube",
  "views_youtube",
  "subscribers_change_our_calculation",
  "views_change_our_calculation",
  "videos_per_week_our_calculation",
  "views_per_video_our_calculation",
] as const;

export function channelSlug(channel: {
  id: string;
  handle?: string | null;
}): string {
  const raw = channel.handle?.trim().replace(/^@/, "") || channel.id;
  return raw.replace(/[^A-Za-z0-9_-]/g, "-");
}

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function suggestionsFilename(
  channel: { id: string; handle?: string | null },
  now: Date = new Date(),
): string {
  return `competitors-${channelSlug(channel)}-${utcDay(now)}.csv`;
}

export function benchmarkFilename(
  channel: { id: string; handle?: string | null },
  days: number,
  now: Date = new Date(),
): string {
  return `benchmark-${channelSlug(channel)}-${days}d-${utcDay(now)}.csv`;
}

export function suggestionsCsv(candidates: Suggestions["candidates"]): string {
  const lines = [SUGGESTION_CSV_COLUMNS.join(",")];
  for (const c of candidates) {
    const reasons = c.reasons
      .map((r) =>
        r.value === undefined || r.value === null
          ? r.kind
          : `${r.kind}:${r.value}`,
      )
      .join(";");
    lines.push(
      [
        c.external_id,
        c.title,
        c.handle,
        c.status,
        c.tier,
        c.sources.join(";"),
        reasons || null,
        c.score,
        c.components?.content ?? null,
        c.components?.locale ?? null,
        c.components?.size ?? null,
        c.subscriber_count,
        c.view_count,
        c.video_count,
        c.country ?? null,
        c.default_language ?? null,
        c.profile_observed_at,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}

export function benchmarkCsv(benchmark: CompetitorBenchmark): string {
  const lines = [BENCHMARK_CSV_COLUMNS.join(",")];
  const ordered = [...benchmark.series].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === "own" ? -1 : 1,
  );
  for (const s of ordered) {
    const days = s.points.map((p) => p.day).sort();
    const firstDay = days[0] ?? null;
    const lastDay = days.length ? days[days.length - 1]! : null;
    lines.push(
      [
        s.kind,
        s.external_id,
        s.title,
        benchmark.days,
        firstDay,
        lastDay,
        s.points.length,
        s.kpis.subscribers,
        s.kpis.views,
        s.kpis.subscribers_change,
        s.kpis.views_change,
        s.kpis.videos_per_week,
        s.kpis.views_per_video,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}
