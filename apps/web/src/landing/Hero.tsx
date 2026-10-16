import { Link } from "react-router";
import "./hero.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { IntroPlayer } from "./IntroPlayer";

export function Hero({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <div className="lp-container lp-hero-copy">
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
              {S.lpSeeHow} <span aria-hidden="true">{S.arrowDownForward}</span>
            </a>
          </Button>
        </div>
      </div>
      {/* The product in twenty seconds is the hero's picture, full width
          under the words that carry the H1 and the search phrases. */}
      <div className="lp-container lp-hero-stage">
        <IntroPlayer locale={locale} />
        <p className="lp-caption">{S.lpHeroCaption}</p>
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
