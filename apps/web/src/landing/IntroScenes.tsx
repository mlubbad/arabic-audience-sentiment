import { BrandMark } from "../BrandMark";
import type { Locale } from "../locale";
import { platformLabel } from "../platformLabel";
import { useStrings, type Strings } from "../strings";
import { SENTIMENTS, numerals, percentOf } from "./demoData";
import {
  INTRO_COMMENTS,
  INTRO_PLATFORMS,
  INTRO_READ,
  INTRO_VIDEOS,
  segmentsOf,
} from "./introData";

/** One scene of the intro's stage: its words on one side, its picture on
 *  the other. The stage is a picture (the player hides it from assistive
 *  technology); the same words are read from the scene list below it. Each
 *  scene is mounted fresh (`key` in Intro.tsx), so its CSS entrances replay
 *  every time it comes round. */
export function IntroScene({
  index,
  ordinal,
  tag,
  title,
  locale,
}: {
  index: number;
  ordinal: string;
  tag: string;
  title: string;
  locale: Locale;
}) {
  const S = useStrings(locale);
  const Picture = PICTURES[index] ?? Collect;
  return (
    <div className={`ix-scene ix-scene--${index + 1}`}>
      <div className="ix-words">
        <span className="ix-tag">
          <b className="ui-num">{ordinal}</b> {tag}
        </span>
        <p className="ix-title">
          {title.split(" ").map((w, i) => (
            <span key={i} className="ix-w">
              {w}{" "}
            </span>
          ))}
        </p>
      </div>
      <div className="ix-picture">
        <Picture S={S} locale={locale} />
      </div>
    </div>
  );
}

type PictureProps = { S: Strings; locale: Locale };

/** 1 — the channels light up and their comments fall into one stream. */
function Collect({ S }: PictureProps) {
  return (
    <div className="ix-collect">
      <div className="ix-platforms">
        {INTRO_PLATFORMS.map((p) => (
          <span key={p} className="ix-chip">
            {platformLabel(p, S)}
          </span>
        ))}
      </div>
      <div className="ix-stream">
        {INTRO_COMMENTS.map((c) => (
          <p key={c.label} className="ix-bubble" lang="ar" dir="rtl">
            {c.text}
          </p>
        ))}
      </div>
    </div>
  );
}

/** 2 — one comment is read word by word; the feeling turns inside the
 *  sentence, so the label is mixed. The dialects follow. */
function Understand({ S, locale }: PictureProps) {
  return (
    <div className="ix-read">
      {/* The comment's own direction on the card, so the beam reads it
          right to left on the English page too. */}
      <div className="ix-focus" lang="ar" dir="rtl">
        <span className="ix-scan" />
        <p>
          {INTRO_READ.map((seg, i) =>
            seg.tone ? (
              <mark key={i} className={`ix-mark ${seg.tone}`}>
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </p>
        <span className="ix-label mixed" lang={locale} dir="auto">
          {S.labels.mixed}
        </span>
      </div>
      <ul className="ix-dialects">
        {INTRO_COMMENTS.map((c) => (
          <li key={c.label}>
            <span>{S.lpIntroDialects[c.dialect]}</span>
            <span className={`ix-label ${c.label}`}>{S.labels[c.label]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 3 — three videos side by side under one filter, each a split bar. */
function Compare({ S, locale }: PictureProps) {
  return (
    <div className="ix-compare">
      {INTRO_VIDEOS.map((shares, v) => (
        <div key={v} className="ix-row">
          <span className="ix-row-name">
            {S.lpIntroVideo(numerals[locale].format(v + 1))}
          </span>
          <svg
            className="ix-bar"
            viewBox="0 0 100 10"
            preserveAspectRatio="none"
          >
            {segmentsOf(shares).map((s) => (
              <rect
                key={s.label}
                className={`ix-seg ${s.label}`}
                x={s.x}
                width={s.width}
                height="10"
              />
            ))}
          </svg>
          <b className="ix-row-pct ui-num">
            {percentOf(locale, shares[0] ?? 0)}
          </b>
        </div>
      ))}
      <div className="ix-legend">
        {SENTIMENTS.map((l) => (
          <span key={l}>
            <i className={`lp-dot ${l}`} />
            {S.labels[l]}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 4 — the mark, what the reader keeps in hand, and the closing line. */
function Decide({ S }: PictureProps) {
  return (
    <div className="ix-decide">
      <span className="ix-badge">
        <BrandMark />
      </span>
      <ul className="ix-checks">
        {[S.lpIntroReview, S.lpIntroExport, S.lpIntroWorkspaces].map((t) => (
          <li key={t}>
            <span className="ix-tick">✓</span>
            {t}
          </li>
        ))}
      </ul>
      <p className="ix-final">
        {S.lpFinalLine1} <em>{S.lpFinalLine2}</em>
      </p>
    </div>
  );
}

const PICTURES = [Collect, Understand, Compare, Decide] as const;
