import { Link } from "react-router";
import "./hero.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ProductWindow } from "./ProductWindow";

export function Hero({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <div className="lp-container lp-hero-grid">
        <div className="lp-hero-copy">
          <Badge tone="neutral" className="lp-eyebrow">
            {S.lpHeroEyebrow}
          </Badge>
          <h1 id="hero-title">
            {S.lpHeroLine1}
            <br />
            {S.lpHeroLine2}
            <br />
            <em>{S.lpHeroLine3}</em>
          </h1>
          <p className="lp-lead">{S.lpHeroLead}</p>
          <div className="lp-actions">
            <Button asChild size="lg">
              <Link to="/dashboard">
                {S.lpExploreDashboard}{" "}
                <span aria-hidden="true">{S.arrowForward}</span>
              </Link>
            </Button>
            <Button asChild variant="ghost" size="lg">
              <a href="#experience">
                {S.lpSeeHow}{" "}
                <span aria-hidden="true">{S.arrowDownForward}</span>
              </a>
            </Button>
          </div>
          <p className="lp-caption">{S.lpHeroCaption}</p>
        </div>
        {/* The sentence that was the illustration's alt is a place in the
            keyword map; it stays as the figure's caption, read and indexed,
            unseen. */}
        <figure className="lp-hero-figure">
          <span className="lp-hero-halo" aria-hidden="true" />
          <ProductWindow mode="still" locale={locale} />
          <figcaption className="ui-sr-only">{S.lpHeroAlt}</figcaption>
        </figure>
      </div>
      <div className="lp-container lp-value-strip">
        {[S.lpValue1, S.lpValue2, S.lpValue3, S.lpValue4].map((v) => (
          <Badge key={v} tone="neutral">
            {v}
          </Badge>
        ))}
      </div>
    </section>
  );
}
