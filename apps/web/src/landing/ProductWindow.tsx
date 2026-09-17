import { useState } from "react";
import "./product-window.css";
import { BrandMark } from "../BrandMark";
import type { Locale } from "../locale";
import { useStrings } from "../strings";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { Tabs, TabsList, TabsTrigger } from "../ui/Tabs";
import {
  SENTIMENTS,
  numerals,
  percentOf,
  sharesFor,
  shownFor,
  type Filter,
  type Sentiment,
} from "./demoData";

const toneOf = (label: Sentiment) =>
  label === "positive"
    ? "positive"
    : label === "negative"
      ? "negative"
      : label === "mixed"
        ? "sentiment-mixed"
        : "sentiment-neutral";

/** The one picture of the product on the page, drawn from the product's own
 *  parts. `still` is the hero's screenshot — no state, no handlers, and its
 *  filter row is plain text, because a picture must not offer controls that
 *  do nothing. `interactive` is the demo: the tabs filter the list, the bar
 *  and the count. Both render the same tree, so what a visitor touches in
 *  the demo is what they saw first. */
export function ProductWindow({
  mode,
  locale,
  initial = "all",
}: {
  mode: "still" | "interactive";
  locale: Locale;
  initial?: Filter;
}) {
  const S = useStrings(locale);
  const [filter, setFilter] = useState<Filter>(initial);
  const active = mode === "interactive" ? filter : initial;
  const shown = shownFor(active);
  const shares = sharesFor(active);
  const labels = S.labels;
  const pct = (v: number) => percentOf(locale, v);
  const barLabel = shares
    .map((c) => `${labels[c.label]}: ${pct(c.percent)}`)
    .join(S.listSeparator);
  const filters: Filter[] = ["all", ...SENTIMENTS];
  const nameOf = (f: Filter) => (f === "all" ? S.all : labels[f]);
  return (
    <div className={`pw pw--${mode}`} data-testid="product-window">
      <div className="pw-chrome">
        <span className="pw-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="pw-brand">
          <BrandMark /> {S.lpDemoBrand}
        </span>
        <span className="pw-caption">{S.lpDemoLabel}</span>
      </div>
      <Card className="pw-body">
        <span className="pw-label">{S.lpDemoChartLabel}</span>
        <div className="pw-figures">
          <Card className="pw-figure">
            <strong className="ui-num">
              {numerals[locale].format(shown.length)}
            </strong>
            <span>{S.lpDemoInSelection}</span>
          </Card>
          <Card className="pw-figure pw-figure--bar">
            <div className="pw-bar" role="img" aria-label={barLabel}>
              {shares.map((c) => (
                <i
                  key={c.label}
                  className={`pw-seg ${c.label}`}
                  style={{ flexGrow: c.percent }}
                />
              ))}
            </div>
            <div className="lp-legend">
              {shares.map((c) => (
                <span key={c.label}>
                  <i className={`lp-dot ${c.label}`} />
                  {labels[c.label]} <b className="ui-num">{pct(c.percent)}</b>
                </span>
              ))}
            </div>
          </Card>
        </div>
        {mode === "interactive" ? (
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList aria-label={S.lpDemoFilterLabel} className="pw-filters">
              {/* No `TabsContent` panels: the tabs filter the list below, in
                  place. Radix still writes each trigger an `aria-controls`
                  naming a panel id that exists nowhere; user props are
                  spread after its own, so `undefined` removes it. */}
              {filters.map((f) => (
                <TabsTrigger key={f} value={f} aria-controls={undefined}>
                  {nameOf(f)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <div className="pw-filters pw-filters--still" aria-hidden="true">
            {filters.map((f) => (
              <span key={f} className={f === active ? "is-active" : undefined}>
                {nameOf(f)}
              </span>
            ))}
          </div>
        )}
        <div
          className="pw-list"
          aria-live={mode === "interactive" ? "polite" : undefined}
        >
          {shown.map((c) => (
            <div className="lp-example-comment" key={c.label}>
              <span className={`pw-avatar ${c.label}`} aria-hidden="true">
                {labels[c.label][0]}
              </span>
              <p lang="ar" dir="rtl">
                {c.text}
              </p>
              <Badge tone={toneOf(c.label)}>{labels[c.label]}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
