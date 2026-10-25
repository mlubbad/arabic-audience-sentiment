/**
 * A page head, not a hero.
 *
 * Inside the shell this is styled flat, on the page's own ground: the dark
 * gradient pane belongs to the landing page, where a reader is being sold
 * something. The eyebrow names the page as the rail does and the workspace
 * the figures belong to, the way the operations page's already did.
 */
import type { Label } from "@sentiment/contracts";
import { Badge, type BadgeProps } from "../ui/Badge";
import { Skeleton } from "../ui/Skeleton";
import type { Strings } from "../strings";
import type { Snapshot } from "./Dashboard";
import { n } from "./format";
import "./hero.css";

/** The sentiment scale's own tone, never `neutral`'s badge default — a
 *  mixed or neutral *result* needs to read differently from an *unset*
 *  filter chip, even though both would otherwise be the same grey. */
const SENTIMENT_TONE: Record<Label, BadgeProps["tone"]> = {
  positive: "positive",
  negative: "negative",
  mixed: "sentiment-mixed",
  neutral: "sentiment-neutral",
};

export function Hero({
  s,
  S,
  workspaceName,
  range,
  labels,
}: {
  s: Snapshot | undefined;
  S: Strings;
  workspaceName: string | null | undefined;
  range: string;
  labels: Record<Label, string>;
}) {
  return (
    <header className="db-hero" data-testid="hero">
      <Badge tone="neutral">
        {S.dashEyebrow} · {workspaceName ?? S.dashDemoTag}
      </Badge>
      <h1>{S.dashTitle}</h1>
      {/* Before the read returns there is no count, and `?? 0` would have
          printed "قراءة 0 تعليقًا" over a page that is still loading —
          unknown rendered as a measurement of none. The banner says what it
          is doing instead, and the figures appear when they exist. */}
      {s ? (
        <>
          {/* What was read. The claim that used to follow — "كل رقم أدناه
              محسوب من الصفوف المحفوظة — لا تقدير ولا استقراء" — is a pitch
              about the method; the provenance strip below says what the
              data is, which is the checkable version of it. */}
          <p>{S.dashRead(n(s.total), s.videos.length)}</p>
          <div className="db-pills">
            <Badge numeric>{range}</Badge>
            <Badge numeric>{S.pillComments(n(s.total))}</Badge>
            <Badge numeric>
              {s.unique_authors != null
                ? S.pillAuthors(n(s.unique_authors))
                : "—"}
            </Badge>
          </div>
          {/* The answer, on the first screen.
              The page asks "ماذا يقول جمهورك؟" at the top and then made the
              reader scroll past ten filter controls and four panels to find
              out — the summary tiles counted comments, replies and authors,
              but not the one split the product exists to produce. It stays
              out of the pills above because those describe the extract
              (when, how many, from whom) and this is the finding.
              Denominator said out loud: the classified rows, not the total. */}
          {s.analysed > 0 && (
            <p className="db-split" data-testid="hero-split">
              <span>{S.splitOf(n(s.analysed))}</span>
              {(Object.keys(s.sentiments) as Label[])
                .filter((k) => s.measurable.has(k))
                .map((k) => (
                  <Badge key={k} tone={SENTIMENT_TONE[k]} numeric>
                    {labels[k]} {n(s.sentiments[k])}
                  </Badge>
                ))}
            </p>
          )}
        </>
      ) : (
        <>
          <p>{S.readingStored}</p>
          <div className="db-pills" aria-hidden="true">
            <Skeleton className="db-sk-pill" />
            <Skeleton className="db-sk-pill" />
            <Skeleton className="db-sk-pill" />
          </div>
        </>
      )}
    </header>
  );
}
