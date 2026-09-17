import { Link } from "react-router";
import "./demo.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ProductWindow } from "./ProductWindow";
import { useReveal } from "./useReveal";

export function Demo({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  return (
    <section
      ref={ref}
      className="lp-section lp-demo"
      id="experience"
      aria-labelledby="experience-title"
    >
      <div className="lp-container">
        <div className="lp-section-head">
          <Badge tone="neutral" className="lp-eyebrow">
            {S.lpExperienceEyebrow}
          </Badge>
          <h2 id="experience-title">
            {S.lpExperienceLine1}
            <br />
            <em>{S.lpExperienceLine2}</em>
          </h2>
          <p className="lp-lead">{S.lpExperienceLead}</p>
        </div>
        <div className="lp-demo-frame">
          <ProductWindow mode="interactive" locale={locale} />
        </div>
        <div className="lp-demo-after">
          <Button asChild variant="secondary">
            <Link to="/dashboard">
              {S.lpDemoLink} <span aria-hidden="true">{S.arrowForward}</span>
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
