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
import type {
  CompetitorBenchmark,
  CompetitorIntelligence,
  Suggestions,
} from "../api/competitors";
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

export const INTELLIGENCE_CSV_COLUMNS = [
  "kind",
  "external_id",
  "title",
  "tier",
  "connection_between_platforms",
  "primary_platform",
  "subscribers_youtube",
  "subscribers_change_our_calculation",
  "videos_per_week_our_calculation",
  "capacity_state_our_estimate",
  "views_per_video_our_calculation",
  "dominant_format_our_estimate",
  "funnel_stage_our_estimate",
  "next_funnel_stage_our_estimate",
  "topics_covered",
  "topic_gaps_our_calculation",
  "tone_of_voice_our_estimate",
  "cta_pattern",
  "conversion_channel",
  "strengths",
  "weaknesses",
  "opportunity_gap",
  "threat_level_our_estimate",
] as const;

export function intelligenceFilename(
  channel: { id: string; handle?: string | null },
  days: number,
  now: Date = new Date(),
): string {
  return `competitor-intelligence-11pt-${channelSlug(channel)}-${days}d-${utcDay(now)}.csv`;
}

export function intelligenceCsv(intel: CompetitorIntelligence): string {
  const lines = [INTELLIGENCE_CSV_COLUMNS.join(",")];
  lines.push(
    [
      "own",
      intel.own.external_id,
      intel.own.title,
      "own",
      intel.own.connection_strategy ?? null,
      intel.own.platform ?? "youtube",
      intel.own.subscribers ?? null,
      intel.own.subscribers_change ?? null,
      intel.own.videos_per_week ?? null,
      null,
      intel.own.views_per_video ?? null,
      intel.own.dominant_format ?? null,
      intel.own.funnel_stage ?? null,
      null,
      (intel.own.topics_covered ?? []).join(";") || null,
      null,
      intel.own.tone_of_voice ?? null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]
      .map(csvCell)
      .join(","),
  );
  for (const c of intel.competitors) {
    lines.push(
      [
        "competitor",
        c.external_id,
        c.title,
        c.tier ?? null,
        c.connection_between_platforms ?? null,
        c.primary_platform ?? null,
        c.subscribers ?? null,
        c.subscribers_change ?? null,
        c.videos_per_week ?? null,
        c.capacity_state ?? null,
        c.views_per_video ?? null,
        c.dominant_format ?? null,
        c.funnel_stage ?? null,
        c.next_funnel_stage ?? null,
        (c.topics_covered ?? []).join(";") || null,
        (c.topic_gaps ?? []).join(";") || null,
        c.tone_of_voice ?? null,
        c.cta_pattern ?? null,
        c.conversion_channel ?? null,
        (c.strengths ?? []).join(";") || null,
        (c.weaknesses ?? []).join(";") || null,
        c.opportunity_gap ?? null,
        c.threat_level ?? null,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}
