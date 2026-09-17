/**
 * The dashboard's page-level states: what a reader sees before the first
 * read returns, while a later one is in flight, when a read or a filter
 * could not be answered, when a workspace or a filtered view has nothing to
 * show, when a chart has no rows to draw, and the notice a fixture-mode card
 * carries about the data it holds.
 *
 * These used to be six inline conditionals inside Dashboard.tsx — three of
 * them ordinary `<div>`s styled from `style.css`'s old amber `.notice`, the
 * other three duplicated between the workspace-empty and filters-empty
 * branches. Pulling them out gives each state a name, a test of its own, and
 * one visual language: a `Card` with a heading and at most one action,
 * rather than a coloured strip.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Skeleton } from "../ui/Skeleton";
import type { Strings } from "../strings";
import "./page-states.css";

/** Before the first read has answered. Skeletons in the rough shape of the
 *  page that is about to appear — the hero line, the filter bar, five KPI
 *  tiles, two charts — so the layout does not jump when real content lands. */
export function Loading({ S }: { S: Strings }) {
  return (
    <div role="status" data-testid="loading" className="db-loading">
      {/* The visible page says nothing while every pixel of it is a
          skeleton; a screen reader still needs a sentence. */}
      <span className="ui-sr-only">{S.loadingComments}</span>
      <Skeleton className="db-sk-hero" aria-hidden="true" />
      <Skeleton className="db-sk-bar" aria-hidden="true" />
      <div className="db-grid">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="db-sk-kpi" aria-hidden="true" />
        ))}
      </div>
      <div className="db-grid db-grid--2">
        <Skeleton className="db-sk-chart" aria-hidden="true" />
        <Skeleton className="db-sk-chart" aria-hidden="true" />
      </div>
    </div>
  );
}

/** A read is already on screen and a filter change or a background refetch
 *  is replacing it. Never shown at the same time as `Loading` — the caller
 *  renders this only once the first read has landed. */
export function Updating({ S }: { S: Strings }) {
  return (
    <p role="status" data-testid="updating" className="updating">
      {S.updatingResults}
    </p>
  );
}

/** The read failed, or it answered but the requested filters could not be
 *  applied to it — two different problems, told apart by `failure`'s prefix,
 *  recovered from the same button. `failure` is a code built only from field
 *  names and a fixed vocabulary (see `failure.ts`); it is safe to print. */
export function LoadError({
  S,
  failure,
  onRetry,
}: {
  S: Strings;
  failure: string | null;
  onRetry: () => void;
}) {
  return (
    <Card role="alert" data-testid="load-error" className="db-error">
      <p>{failure?.startsWith("view:") ? S.filtersFailed : S.loadFailed}</p>
      {/* Small, and last — for the person who has to fix it, not the person
          reading the report. */}
      <p className="db-muted" data-testid="failure-code">
        {S.failureCode} <code>{failure}</code>
      </p>
      <Button variant="secondary" onClick={onRetry}>
        {S.retry}
      </Button>
    </Card>
  );
}

/**
 * A workspace with no rows at all, and a filtered view that matched none of
 * them, are the same shape of nothing with opposite advice — the page used to
 * give both the same sentence, which told a brand-new reader with no filters
 * set to change filters they had never touched.
 *
 * `kind="workspace"` optionally carries `setup`, the three-step path to a
 * first comment (live mode only — the caller decides, since only it knows
 * whether this is a fixture); `kind="filters"` optionally carries `onReset`,
 * the same reset the filter bar's own control calls.
 */
export function EmptyState({
  kind,
  S,
  lead,
  setup,
  onReset,
  links,
}: {
  kind: "workspace" | "filters";
  S: Strings;
  /** The workspace branch's lead is a fixed sentence; the filters branch's
   *  names the total the filters excluded, which only the caller knows. */
  lead?: ReactNode;
  setup?: ReactNode;
  onReset?: () => void;
  links?: { to: string; label: string }[];
}) {
  return (
    <Card className="db-empty" data-testid="empty-state">
      {kind === "workspace" ? (
        <>
          <h2>{S.emptyNoCommentsTitle}</h2>
          <p className="db-lead">{lead ?? S.emptyNoCommentsLead}</p>
          {setup}
          {links && links.length > 0 && (
            <div className="db-row-actions db-empty-actions">
              {links.map((link, i) => (
                <Button
                  key={link.to}
                  asChild
                  variant={i === 0 ? "primary" : "secondary"}
                >
                  <Link to={link.to}>{link.label}</Link>
                </Button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <h2>{S.emptyNoMatchTitle}</h2>
          {lead && <p className="db-lead">{lead}</p>}
          {/* `S.showAllComments`, deliberately not `S.resetFilters` — the
              filter bar's own reset control already carries that name, and a
              second control with the same label on the same page names the
              mechanism twice and the result never. */}
          {onReset && (
            <div className="db-row-actions db-empty-actions">
              <Button variant="secondary" onClick={onReset}>
                {S.showAllComments}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** The in-card sentence a chart shows instead of drawing on zero rows —
 *  never a blank canvas, which reads as broken rather than as "nothing here
 *  yet". `testId` lets each chart's empty state be found on its own. */
export function ChartEmpty({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <p className="db-chart-empty" data-testid={testId}>
      {children}
    </p>
  );
}

/** The fixed notice a fixture-mode card carries: this data is synthetic,
 *  belongs to no real channel, and a correction made against it is never
 *  sent anywhere. Kept as one small component so a card that needs it — the
 *  landing page's interactive demo, an account page preview — renders it the
 *  same way once, rather than writing the three sentences again. The
 *  dashboard's own header no longer needs this: `dataSource.ts` derives its
 *  provenance strip from the same values that decide behaviour, which is
 *  the safer source of truth for a screen that can also be live. */
export function FixtureNotice({ S }: { S: Strings }) {
  return (
    <Card className="db-fixture" data-testid="fixture-notice">
      <Badge tone="neutral">{S.dashDemoTag}</Badge>
      <p>{S.dsFixtureScope}</p>
      <p>{S.dsReviewsSessionOnly}</p>
    </Card>
  );
}
