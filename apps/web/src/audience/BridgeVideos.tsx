import type { SharedVideos } from "../api/audience";
import { displayDate } from "../i18n";
import { n } from "../dashboard/format";
import type { Locale } from "../locale";
import type { Strings } from "../strings";

export function BridgeVideos({
  data,
  platform,
  lang,
  S,
}: {
  data: SharedVideos | undefined;
  /** Only YouTube has a video address we can build; others show the title. */
  platform: string;
  lang: Locale;
  S: Strings;
}) {
  if (!data) return <p>{S.audienceVideosLoading}</p>;
  if (data.status === "below_threshold") return <p>{S.audienceInsufficient}</p>;
  if (!data.videos.length) return <p>{S.audienceNoVideos}</p>;
  return (
    <section className="audience-panel">
      <h2>{S.audienceVideos}</h2>
      <ul>
        {data.videos.map((video) => (
          <li key={video.video_id}>
            {platform === "youtube" && video.external_video_id ? (
              <a
                href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.external_video_id)}`}
                target="_blank"
                rel="noreferrer"
              >
                {video.title || video.external_video_id}
              </a>
            ) : (
              <span>
                {video.title || video.external_video_id || video.video_id}
              </span>
            )}
            <span>{displayDate(video.published_at, lang)}</span>
            <span>
              {S.audienceOurCalculation}: {n(video.shared_commenters)} ·{" "}
              {n(video.affinity)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
