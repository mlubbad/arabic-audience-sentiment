import "./benefits.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { useReveal } from "./useReveal";

export function Benefits({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  const items = [
    { tag: S.lpBenefit1Tag, title: S.lpBenefit1Title, text: S.lpBenefit1 },
    { tag: S.lpBenefit2Tag, title: S.lpBenefit2Title, text: S.lpBenefit2 },
    { tag: S.lpBenefit3Tag, title: S.lpBenefit3Title, text: S.lpBenefit3 },
  ];
  return (
    // No `aria-label`: it carried the first card's tag, which named the
    // section after one of its three parts. Unnamed, the section is not a
    // landmark, and the three h3s carry it in the outline.
    <section ref={ref} className="lp-section lp-benefits">
      <div className="lp-container lp-grid-3">
        {items.map((b) => (
          <Card key={b.tag} className="lp-benefit">
            <Badge tone="neutral" numeric>
              {b.tag}
            </Badge>
            <h3>{b.title}</h3>
            <p>{b.text}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
