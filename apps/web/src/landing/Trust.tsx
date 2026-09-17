import "./trust.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { useReveal } from "./useReveal";

export function Trust({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  const items = [
    { glyph: "◉", title: S.lpTrust1Title, text: S.lpTrust1 },
    { glyph: "↻", title: S.lpTrust2Title, text: S.lpTrust2 },
    { glyph: S.arrowUpForward, title: S.lpTrust3Title, text: S.lpTrust3 },
  ];
  return (
    <section
      ref={ref}
      className="lp-section lp-section--muted lp-trust"
      aria-labelledby="trust-title"
    >
      <div className="lp-container">
        <div className="lp-section-head lp-section-head--start">
          <Badge tone="neutral" className="lp-eyebrow">
            {S.lpTrustEyebrow}
          </Badge>
          <h2 id="trust-title">
            {S.lpTrustLine1}
            <br />
            {S.lpTrustLine2} <em>{S.lpTrustLine3}</em>
          </h2>
          <p className="lp-lead">{S.lpTrustLead}</p>
        </div>
        <div className="lp-grid-3">
          {items.map((t) => (
            <Card key={t.title} className="lp-trust-item">
              <span className="lp-trust-glyph" aria-hidden="true">
                {t.glyph}
              </span>
              <h3>{t.title}</h3>
              <p>{t.text}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
