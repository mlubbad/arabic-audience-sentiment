/**
 * The selection bar: what is ticked, what it would cost, and the save.
 *
 * Pinned to the bottom of the viewport while the list is on screen
 * (`.db-selection-bar` in catalogue.css), so a long catalogue on a phone
 * never puts the price out of reach. The estimate is `selectionEstimate`
 * from the contract — the same arithmetic `select_videos` refuses on —
 * handed in by `Catalogue`, which also decides whether the save is offered:
 * this bar prints and presses, it does not price.
 */
import type { selectionEstimate } from "@sentiment/contracts";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import type { Strings } from "../strings";

export function SelectionBar({
  ticked,
  est,
  remaining,
  busy,
  saveDisabled,
  onSave,
  feedback,
  S,
}: {
  /** How many boxes are ticked, stored or new. */
  ticked: number;
  est: ReturnType<typeof selectionEstimate>;
  /** The plan's remaining analysis units; null with no plan. */
  remaining: number | null;
  busy: boolean;
  saveDisabled: boolean;
  onSave: () => void;
  feedback: string | null;
  S: Strings;
}) {
  return (
    <Card className="db-selection-bar" data-tour="selection">
      <p
        className="db-selection-line"
        data-testid="cat-estimate"
        data-exceeds={est.exceeds}
      >
        {/* Everything ticked that is not yet stored: this selection's
            additions and what the stored selections still owe. */}
        {S.catSelected(ticked, est.estimate + est.outstanding)}
        {est.unknownCount > 0
          ? ` · ${S.catUnknownCount(est.unknownCount)}`
          : ""}
        {" · "}
        {remaining === null
          ? S.catNoPlan
          : est.exceeds
            ? S.catExceeds
            : S.catRemainingAfter(est.remainingAfter ?? 0)}
      </p>
      <Button data-testid="cat-save" disabled={saveDisabled} onClick={onSave}>
        {busy ? S.catSaving : S.catSave}
      </Button>
      <small className="db-note">{S.catLiveNote}</small>
      {feedback && (
        <p
          role="status"
          className="db-selection-feedback"
          data-testid="cat-feedback"
        >
          {feedback}
        </p>
      )}
    </Card>
  );
}
