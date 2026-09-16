/**
 * The four-bar mark, drawn once.
 *
 * It used to be four `<i>` elements painted by CSS — and painted three times:
 * `landing.css`, `app.css`, and the OAuth-branding render, each with its own
 * proportions, and two of them with a rose typed by hand that was not the
 * brand's `--ml-rose`. One meaning, three implementations: the exact shape
 * this codebase's retrospective names as its most common bug. Now the geometry
 * is one table (`brandMark.geometry.mjs`, read by this component and by the
 * favicon/logo renderer alike) and the colours are the tokens, so the rail,
 * the landing, the favicon and the OAuth logo cannot disagree.
 *
 * `currentColor` for the three indigo bars, so a surface tints them by setting
 * `color` — that is what replaced the rail's gradient override. The rose bar
 * reads the token directly: it is the one part that must stay the same on
 * every surface, since a rose that drifts is the drift that shipped.
 */
import {
  BRAND_MARK_BARS,
  BRAND_MARK_ROTATION,
  BRAND_MARK_SIZE,
  BRAND_MARK_VIEWBOX,
} from "./brandMark.geometry.mjs";

const centre = BRAND_MARK_SIZE / 2;

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `lp-mark ${className}` : "lp-mark"}
      viewBox={BRAND_MARK_VIEWBOX}
      aria-hidden="true"
      focusable="false"
    >
      <g transform={`rotate(${BRAND_MARK_ROTATION} ${centre} ${centre})`}>
        {BRAND_MARK_BARS.map((b) => (
          <rect
            key={b.x}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={b.w / 2}
            fill={b.rose ? "var(--ml-rose)" : "currentColor"}
          />
        ))}
      </g>
    </svg>
  );
}
