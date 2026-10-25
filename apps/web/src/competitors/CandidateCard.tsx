import { useStrings, type Strings } from "../strings";
import { n } from "../dashboard/format";
import type { Suggestions } from "../api/competitors";
import { Button } from "../ui/Button";

export function reasonLabel(
  r: { kind: string; value?: unknown },
  S: Strings,
): string | null {
  return r.kind === "shared_topics"
    ? S.compSharedTopics(n(Number(r.value)))
    : r.kind === "same_language"
      ? S.compSameLanguage
      : r.kind === "same_country"
        ? S.compSameCountry
        : r.kind === "size_ratio"
          ? S.compSizeRatio(n(Number(r.value)))
          : null;
}

export function tierLabel(tier: string | null, S: Strings): string | null {
  if (!tier) return null;
  return (S[`compTier_${tier}` as keyof Strings] as string | undefined) ?? tier;
}

export function CandidateCard({
  item,
  canEdit,
  pending,
  act,
}: {
  item: Suggestions["candidates"][number];
  canEdit: boolean;
  pending: boolean;
  act: (decision: "tracked" | "dismissed" | "clear") => void;
}) {
  const S = useStrings();
  const title = item.title || item.handle || item.external_id;
  return (
    <article className="competitor-card">
      <h3>
        <a
          href={`https://www.youtube.com/channel/${encodeURIComponent(item.external_id)}`}
          target="_blank"
          rel="noopener"
        >
          {title}
        </a>
      </h3>
      <p>
        {item.sources
          .map((x) =>
            x === "featured"
              ? S.compFeatured
              : x === "manual"
                ? S.compAdded
                : null,
          )
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p>
        {S.compStats}: {S.compSubscribers}{" "}
        {item.subscriber_count == null ? "—" : n(item.subscriber_count)} ·{" "}
        {S.compViews} {item.view_count == null ? "—" : n(item.view_count)} ·{" "}
        {S.compVideos} {item.video_count == null ? "—" : n(item.video_count)}
      </p>
      <p>
        {S.compMatch}:{" "}
        {item.score == null
          ? S.compNoScore
          : `${n(Math.round(item.score * 100))}% (${S.compEstimate})`}
      </p>
      {item.profile_observed_at == null && <p>{S.compCollecting}</p>}
      {item.tier && (
        <p>
          <span
            className="competitor-tier"
            title={tierLabel(item.tier, S) ?? undefined}
          >
            {item.tier}
          </span>
        </p>
      )}
      <ul>
        {item.reasons.map((r, i) => (
          <li key={i}>{reasonLabel(r, S)}</li>
        ))}
      </ul>
      {canEdit && (
        <div className="competitor-actions">
          <Button
            disabled={pending}
            onClick={() => act(item.status === "tracked" ? "clear" : "tracked")}
          >
            {item.status === "tracked" ? S.compStop : S.compTrack}
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => act("dismissed")}
          >
            {S.compDismiss}
          </Button>
        </div>
      )}
    </article>
  );
}
