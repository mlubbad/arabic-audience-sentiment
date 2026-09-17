import "./faq.css";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/Accordion";
import { useReveal } from "./useReveal";

export function Faq({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const ref = useReveal<HTMLElement>();
  /* Question, answer, question, answer: a flat list in the strings, read in
     pairs, so a translation cannot carry a question without its answer or an
     answer under the wrong question. The DOM order is the FAQPage data's. */
  const pairs = Array.from({ length: S.lpFaq.length / 2 }, (_, i) => [
    S.lpFaq[i * 2],
    S.lpFaq[i * 2 + 1],
  ]);
  return (
    <section
      ref={ref}
      className="lp-section lp-section--muted lp-faq"
      id="questions"
      aria-labelledby="faq-title"
    >
      <div className="lp-container lp-faq-grid">
        <div className="lp-section-head lp-section-head--start">
          <Badge tone="neutral" className="lp-eyebrow">
            {S.lpFaqEyebrow}
          </Badge>
          <h2 id="faq-title">{S.lpFaqTitle}</h2>
          <p className="lp-lead">{S.lpFaqLead}</p>
        </div>
        <Accordion type="single" collapsible className="lp-faq-list">
          {pairs.map(([q, a], i) => (
            <AccordionItem key={q} value={`q${i}`}>
              <AccordionTrigger>{q}</AccordionTrigger>
              <AccordionContent>{a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
