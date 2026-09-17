import { Link } from "react-router";
import "./closing.css";
import { BrandMark } from "../BrandMark";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import { useReveal } from "./useReveal";

export function Closing({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  return (
    <section ref={ref} className="lp-section lp-closing">
      <span className="lp-orbit" aria-hidden="true" />
      <div className="lp-container lp-closing-inner">
        <BrandMark />
        <h2>
          {S.lpFinalLine1}
          <br />
          <em>{S.lpFinalLine2}</em>
        </h2>
        <p className="lp-lead">{S.lpFinalLead}</p>
        <Button asChild size="lg" className="lp-closing-cta">
          <Link to="/dashboard">
            {S.lpExploreDashboard}{" "}
            <span aria-hidden="true">{S.arrowForward}</span>
          </Link>
        </Button>
        <span className="lp-caption">{S.lpFinalCaption}</span>
      </div>
    </section>
  );
}
