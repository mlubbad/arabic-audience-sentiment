import { useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type {
  CompetitorIntelEntry,
  CompetitorIntelligence as CompetitorIntelligenceData,
} from "../api/competitors";
import type { Strings } from "../strings";
import { n } from "../dashboard/format";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { tierLabel } from "./CandidateCard";
import { useUpsertCompetitorIntelligence } from "./useCompetitors";
import "./intelligence.css";

export function connLabel(code: string | undefined, S: Strings): string {
  if (!code) return "—";
  return (
    (S[`compIntelConn_${code}` as keyof Strings] as string | undefined) ?? code
  );
}

export function capLabel(code: string | undefined, S: Strings): string {
  if (!code) return "—";
  return (
    (S[`compIntelCap_${code}` as keyof Strings] as string | undefined) ?? code
  );
}

export function formatLabel(code: string | undefined, S: Strings): string {
  if (!code) return "—";
  return (
    (S[`compIntelFormat_${code}` as keyof Strings] as string | undefined) ??
    code
  );
}

export function funnelLabel(code: string | undefined, S: Strings): string {
  if (!code) return "—";
  return (
    (S[`compIntelFunnel_${code}` as keyof Strings] as string | undefined) ??
    code
  );
}

export function toneLabel(code: string | undefined, S: Strings): string {
  if (!code) return "—";
  return (
    (S[`compIntelTone_${code}` as keyof Strings] as string | undefined) ?? code
  );
}

export function threatLabel(
  code: string | null | undefined,
  S: Strings,
): string {
  if (!code) return "—";
  return (
    (S[`compIntelThreat_${code}` as keyof Strings] as string | undefined) ??
    code
  );
}

export function gapLabel(code: string | null | undefined, S: Strings): string {
  if (!code) return "—";
  return (
    (S[`compIntelGap_${code}` as keyof Strings] as string | undefined) ?? code
  );
}

export function strengthLabel(code: string, S: Strings): string {
  return (
    (S[`compIntelStr_${code}` as keyof Strings] as string | undefined) ?? code
  );
}

export function weaknessLabel(code: string, S: Strings): string {
  return (
    (S[`compIntelWeak_${code}` as keyof Strings] as string | undefined) ?? code
  );
}

export function cleanTopicUrl(raw: string): string {
  try {
    const seg = decodeURIComponent(raw.split("/").pop() || raw);
    return seg.replace(/_/g, " ");
  } catch {
    return raw;
  }
}

export function outflankStepsForStage(
  stage: string | undefined,
  S: Strings,
): string[] {
  const current = funnelLabel(stage ?? "awareness", S);
  const next = funnelLabel(
    stage === "awareness"
      ? "consideration"
      : stage === "consideration"
        ? "decision"
        : "decision",
    S,
  );
  return [
    `1. ابدأ بطرح المشكلة التي يركز عليها المنافس في مرحلة (${current}) بلغة مباشرة.`,
    `2. قدّم نصيحة عملية قابلة للتطبيق الذاتي فورًا لبناء الثقة السريعة.`,
    `3. اسبقه بدمج مرحلة (${next}) عبر دعوة تحويل واضحة في نهاية المحتوى.`,
  ];
}

function BattlecardItem({
  channel,
  item,
  canEdit,
  S,
}: {
  channel: string;
  item: CompetitorIntelEntry;
  canEdit: boolean;
  S: Strings;
}) {
  const [editing, setEditing] = useState(false);
  const [funnelStage, setFunnelStage] = useState(
    item.funnel_stage ?? "awareness",
  );
  const [tone, setTone] = useState(item.tone_of_voice ?? "semi_formal");
  const [domFormat, setDomFormat] = useState(item.dominant_format ?? "video");
  const [ctaPattern, setCtaPattern] = useState(item.cta_pattern ?? "");
  const [gapText, setGapText] = useState(item.opportunity_gap ?? "");
  const upsert = useUpsertCompetitorIntelligence(channel);

  const steps = outflankStepsForStage(item.funnel_stage, S);
  const gaps = (item.topic_gaps ?? []).map(cleanTopicUrl);

  async function saveProfile() {
    await upsert.mutateAsync({
      candidateExternalId: item.external_id,
      profile: {
        dominant_format: domFormat,
        funnel_stage: funnelStage,
        tone_of_voice: tone,
        cta_pattern: ctaPattern.trim() || null,
        conversion_channel: item.conversion_channel ?? null,
        opportunity_gap: gapText.trim() || null,
        threat_level: item.threat_level ?? "medium",
      },
    });
    setEditing(false);
  }

  return (
    <article
      className="intel-battlecard"
      data-testid={`battlecard-${item.external_id}`}
    >
      <div className="intel-battlecard-head">
        <div>
          <h4>{item.title}</h4>
          <small>
            {capLabel(item.capacity_state, S)} ·{" "}
            {funnelLabel(item.funnel_stage, S)}
          </small>
        </div>
        <div className="intel-badges">
          {item.tier && (
            <Badge tone="neutral">{tierLabel(item.tier, S) ?? item.tier}</Badge>
          )}
          {item.threat_level && (
            <Badge
              tone={
                item.threat_level === "high"
                  ? "negative"
                  : item.threat_level === "medium"
                    ? "warning"
                    : "positive"
              }
            >
              {threatLabel(item.threat_level, S)}
            </Badge>
          )}
        </div>
      </div>

      <div className="intel-swot-grid">
        <div className="intel-swot-box">
          <h5>{S.compIntelStrengths}</h5>
          <ul>
            {(item.strengths ?? []).length > 0 ? (
              (item.strengths ?? []).map((st, idx) => (
                <li key={idx}>{strengthLabel(st, S)}</li>
              ))
            ) : (
              <li>—</li>
            )}
          </ul>
        </div>
        <div className="intel-swot-box">
          <h5>{S.compIntelWeaknesses}</h5>
          <ul>
            {(item.weaknesses ?? []).length > 0 ? (
              (item.weaknesses ?? []).map((wk, idx) => (
                <li key={idx}>{weaknessLabel(wk, S)}</li>
              ))
            ) : (
              <li>—</li>
            )}
          </ul>
        </div>
      </div>

      <div className="intel-gap-callout">
        <strong>{S.compIntelOpportunityGap}</strong>
        <span>{gapLabel(item.opportunity_gap, S)}</span>
      </div>

      <div>
        <strong>{S.compIntelOutflankTitle}</strong>
        <ol className="intel-outflank-list">
          {steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>

      {gaps.length > 0 && (
        <p>
          <strong>{S.compIntelTopicGapsLabel}:</strong> {gaps.join(" · ")}
        </p>
      )}

      {canEdit && !editing && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => setEditing(true)}
          >
            {S.compIntelEditBtn}
          </Button>
        </div>
      )}

      {canEdit && editing && (
        <div className="intel-edit-form">
          <label>
            {S.compIntelColFormat}
            <select
              value={domFormat}
              onChange={(e) => setDomFormat(e.target.value)}
            >
              {["video", "short", "stream", "carousel", "post", "mixed"].map(
                (f) => (
                  <option key={f} value={f}>
                    {formatLabel(f, S)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            {S.compIntelColFunnel}
            <select
              value={funnelStage}
              onChange={(e) => setFunnelStage(e.target.value)}
            >
              {["awareness", "consideration", "engagement", "decision"].map(
                (st) => (
                  <option key={st} value={st}>
                    {funnelLabel(st, S)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            {S.compIntelColTone}
            <select value={tone} onChange={(e) => setTone(e.target.value)}>
              {[
                "formal",
                "semi_formal",
                "casual",
                "irreverent",
                "bilingual_friendly",
                "bilingual_premium",
              ].map((t) => (
                <option key={t} value={t}>
                  {toneLabel(t, S)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {S.compIntelColCta}
            <input
              type="text"
              value={ctaPattern}
              maxLength={250}
              onChange={(e) => setCtaPattern(e.target.value)}
              placeholder="CTA"
            />
          </label>
          <label>
            {S.compIntelOpportunityGap}
            <input
              type="text"
              value={gapText}
              maxLength={400}
              onChange={(e) => setGapText(e.target.value)}
            />
          </label>
          <div className="intel-edit-actions">
            <Button
              size="sm"
              type="button"
              disabled={upsert.isPending}
              onClick={() => void saveProfile()}
            >
              {S.compIntelSaveBtn}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => setEditing(false)}
            >
              {S.addChannelCancel}
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

export function CompetitorIntelligence({
  channel,
  canEdit,
  intelligenceQuery,
  S,
}: {
  channel: string;
  canEdit: boolean;
  intelligenceQuery: UseQueryResult<CompetitorIntelligenceData | null, Error>;
  S: Strings;
}) {
  if (intelligenceQuery.isPending) return null;
  const intel = intelligenceQuery.data;
  if (!intel || !intel.competitors.length) return null;

  const { own, competitors, pacing_plan: pacing } = intel;

  return (
    <section
      className="competitor-intel"
      data-testid="competitor-intelligence"
      aria-label={S.compIntelTitle}
    >
      <header>
        <h2>{S.compIntelTitle}</h2>
        <p>{S.compIntelSubtitle}</p>
      </header>

      {pacing && (
        <div className="intel-pacing-card" data-testid="intel-pacing-plan">
          <h3>{S.compIntelPacingTitle}</h3>
          <p>{S.compIntelPacingNote}</p>
          <div className="intel-pacing-grid">
            <div className="intel-pacing-stat">
              <span>{S.compIntelCurrentCadence}</span>
              <strong>
                {pacing.current_weekly_posts == null
                  ? "—"
                  : n(Number(pacing.current_weekly_posts.toFixed(1)))}
              </strong>
            </div>
            <div className="intel-pacing-stat">
              <span>{S.compIntelTargetCadence}</span>
              <strong>
                {pacing.recommended_weekly_posts == null
                  ? "—"
                  : n(Number(pacing.recommended_weekly_posts.toFixed(1)))}
              </strong>
            </div>
            <div className="intel-pacing-stat">
              <span>{S.compIntelWeek1}</span>
              <div className="intel-schedule-pills">
                {pacing.week_1_schedule.map((cnt, idx) => (
                  <span key={idx} className="intel-schedule-pill">
                    {n(cnt)}
                  </span>
                ))}
              </div>
            </div>
            <div className="intel-pacing-stat">
              <span>{S.compIntelWeek2}</span>
              <div className="intel-schedule-pills">
                {pacing.week_2_schedule.map((cnt, idx) => (
                  <span key={idx} className="intel-schedule-pill">
                    {n(cnt)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div>
        <h3>{S.compIntelMatrixTitle}</h3>
        <div className="intel-matrix-wrap">
          <table className="intel-matrix-table">
            <thead>
              <tr>
                <th>{S.compIntelColChannel}</th>
                <th>{S.compIntelColPlatforms}</th>
                <th>{S.compIntelColScale}</th>
                <th>{S.compIntelColCapacity}</th>
                <th>{S.compIntelColEngagement}</th>
                <th>{S.compIntelColFormat}</th>
                <th>{S.compIntelColFunnel}</th>
                <th>{S.compIntelColTopics}</th>
                <th>{S.compIntelColTone}</th>
                <th>{S.compIntelColCta}</th>
                <th>{S.compIntelColThreat}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="intel-matrix-own">
                <th>
                  {own.title}{" "}
                  <Badge tone="neutral">{S.compIntelOwnBadge}</Badge>
                </th>
                <td>
                  {connLabel(own.connection_strategy, S)} (
                  {(
                    own.connected_platforms ?? [own.platform ?? "youtube"]
                  ).join(" + ")}
                  )
                </td>
                <td>{own.subscribers == null ? "—" : n(own.subscribers)}</td>
                <td>
                  {own.videos_per_week == null
                    ? "—"
                    : `${n(Number(own.videos_per_week.toFixed(1)))} / wk`}
                </td>
                <td>
                  {own.views_per_video == null
                    ? "—"
                    : n(Math.round(own.views_per_video))}
                </td>
                <td>{formatLabel(own.dominant_format, S)}</td>
                <td>{funnelLabel(own.funnel_stage, S)}</td>
                <td>
                  {(own.topics_covered ?? []).map(cleanTopicUrl).join(" · ") ||
                    "—"}
                </td>
                <td>{toneLabel(own.tone_of_voice, S)}</td>
                <td>—</td>
                <td>—</td>
              </tr>
              {competitors.map((c) => (
                <tr key={c.external_id}>
                  <th>{c.title}</th>
                  <td>
                    {connLabel(c.connection_between_platforms, S)} (
                    {c.primary_platform ?? "youtube"})
                  </td>
                  <td>
                    {c.subscribers == null ? "—" : n(c.subscribers)}
                    {c.size_ratio != null ? ` (${n(c.size_ratio)}×)` : ""}
                  </td>
                  <td>
                    {c.videos_per_week == null
                      ? "—"
                      : `${n(Number(c.videos_per_week.toFixed(1)))} / wk`}{" "}
                    · {capLabel(c.capacity_state, S)}
                  </td>
                  <td>
                    {c.views_per_video == null
                      ? "—"
                      : n(Math.round(c.views_per_video))}
                    {c.views_per_video_ratio_vs_own != null
                      ? ` (${n(c.views_per_video_ratio_vs_own)}×)`
                      : ""}
                  </td>
                  <td>{formatLabel(c.dominant_format, S)}</td>
                  <td>
                    {funnelLabel(c.funnel_stage, S)} →{" "}
                    {funnelLabel(c.next_funnel_stage, S)}
                  </td>
                  <td>
                    {(c.topics_covered ?? []).map(cleanTopicUrl).join(" · ") ||
                      "—"}
                  </td>
                  <td>{toneLabel(c.tone_of_voice, S)}</td>
                  <td>
                    {[c.cta_pattern, c.conversion_channel]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td>
                    {threatLabel(c.threat_level, S)} ·{" "}
                    {gapLabel(c.opportunity_gap, S)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3>{S.compIntelBattlecardsTitle}</h3>
        <div className="intel-battlecards-grid">
          {competitors.map((c) => (
            <BattlecardItem
              key={c.external_id}
              channel={channel}
              item={c}
              canEdit={canEdit}
              S={S}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
