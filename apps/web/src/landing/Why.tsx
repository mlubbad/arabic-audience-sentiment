import "./why.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { useReveal } from "./useReveal";

export function Why({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  return (
    <section
      ref={ref}
      className="lp-section lp-section--muted lp-why"
      id="why"
      aria-labelledby="why-title"
    >
      <div className="lp-container lp-section-head">
        <Badge tone="neutral" className="lp-eyebrow">
          {S.lpWhyEyebrow}
        </Badge>
        <h2 id="why-title">
          {S.lpWhyLine1}
          <br />
          <em>{S.lpWhyLine2}</em>
        </h2>
        <p className="lp-lead">{S.lpWhyLead}</p>
        <Button asChild variant="secondary">
          <a href="#experience">
            {S.lpZoomIn} <span aria-hidden="true">↓</span>
          </a>
        </Button>
      </div>
    </section>
  );
}
