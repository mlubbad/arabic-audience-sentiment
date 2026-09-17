/**
 * The correction dialog, on `ui/Dialog`. `Dashboard.tsx` still owns every
 * piece of state a correction touches — `reviewing`, `verdict`,
 * `reviewKind`, `topicVerdict`, `reason`, the two mutations, `closeReview`,
 * `startReview` and `startTopicReview` — this component only renders what
 * they describe and reports back through `onVerdict` / `onTopicVerdict` /
 * `onReason` / `onSubmit` / `onClose`.
 *
 * Opening moves focus onto the form itself (`onOpenAutoFocus`), the same
 * behaviour the inline form's own focus effect used to give it.
 *
 * Closing returns focus to the row's `تصحيح` button, through `triggerRef` —
 * still `Dashboard.tsx`'s `reviewTriggerRef`, set in `startReview` /
 * `startTopicReview` — but the call to `.focus()` had to move twice before
 * it actually worked:
 *
 * 1. First it lived in `closeReview`, called from `onOpenChange`. That runs
 *    while `DialogContent`'s focus trap is still mounted, so the trap stole
 *    focus straight back on the same tick.
 * 2. Dropping it and leaving Radix's own `onCloseAutoFocus` default did
 *    nothing either: that default only refocuses a `Dialog.Trigger`
 *    element, and this dialog is opened programmatically (`open` driven by
 *    `reviewing`) — there never is one, so Radix's default silently
 *    preventDefaults and focuses nothing.
 *
 * Calling it here, inside `onCloseAutoFocus` itself, is the moment Radix
 * has already released the trap and is asking where focus should go next —
 * so this is the one place the call actually lands. `closeReview` (reached
 * through `onClose`) only clears `reviewing` now; it does not touch focus.
 */
import { useRef, type RefObject } from "react";
import type { Label, LabelledComment } from "@sentiment/contracts";
import { Dialog, DialogContent, DialogTitle } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { SelectItem } from "../ui/Select";
import { Labelled } from "./Labelled";
import { commentText, displayDate } from "../i18n";
import { reviewHistory } from "../reviewHistory";
import type { Strings } from "../strings";
import type { Locale } from "../locale";
import type { Snapshot } from "./Dashboard";
import "./review-dialog.css";

export function ReviewDialog({
  reviewing,
  kind,
  verdict,
  onVerdict,
  topicVerdict,
  onTopicVerdict,
  reason,
  onReason,
  topics,
  topicName,
  labels,
  S,
  lang,
  persisted,
  busy,
  error,
  onSubmit,
  onClose,
  triggerRef,
}: {
  reviewing: LabelledComment | null;
  kind: "sentiment" | "topic";
  verdict: Label;
  onVerdict: (l: Label) => void;
  topicVerdict: string;
  onTopicVerdict: (k: string) => void;
  reason: string;
  onReason: (r: string) => void;
  topics: Snapshot["topics"];
  topicName: (key: string) => string;
  labels: Record<Label, string>;
  S: Strings;
  lang: Locale;
  persisted: boolean;
  busy: boolean;
  error: Error | null;
  onSubmit: () => void;
  onClose: () => void;
  /** The row's `تصحيح` / `تعديل الموضوع` button — where focus goes back to
   *  on close. See the file comment for why this has to happen inside
   *  `onCloseAutoFocus` rather than in `onClose`/`closeReview` itself. */
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  return (
    <Dialog
      open={!!reviewing}
      onOpenChange={(next) => {
        // A save in flight cannot be backed out of by Escape, the overlay or
        // the corner ✕: all three route through here.
        if (!next && busy) return;
        if (!next) onClose();
      }}
    >
      {reviewing && (
        <DialogContent
          className="db-review-dialog"
          // Distinct from the form's own Cancel button below (`S.cancel`,
          // "إلغاء"): the two would otherwise share one accessible name and
          // `getByRole("button", { name: … })` could no longer tell them
          // apart. `S.adminDeleteClose` is the same "إغلاق" `DeleteWorkspaceDialog.tsx`
          // already gives this exact prop.
          closeLabel={S.adminDeleteClose}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            formRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            // Radix's own default only refocuses a `Dialog.Trigger`, which
            // this dialog never has — see the file comment. `triggerRef` is
            // the row's own button.
            e.preventDefault();
            if (
              triggerRef.current &&
              document.body.contains(triggerRef.current)
            ) {
              // Still on the page: focus it directly.
              triggerRef.current.focus();
            } else {
              // A save can drop the row out of the current filter (e.g. a
              // "غير المراجَع" view after the correction lands) — the button
              // that opened this dialog is gone, so focus the section
              // heading instead of silently falling through to `<body>`.
              document.getElementById("rp-comments-title")?.focus();
            }
          }}
        >
          <form
            ref={formRef}
            tabIndex={-1}
            aria-label={
              kind === "topic" ? S.reviewTopicTitle : S.reviewFormLabel
            }
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            <DialogTitle asChild>
              <h3>{kind === "topic" ? S.reviewTopicTitle : S.reviewTitle}</h3>
            </DialogTitle>
            <blockquote className="db-review-quote" data-testid="review-text">
              {commentText(reviewing, S)}
            </blockquote>
            <p className="db-muted">
              {kind === "topic"
                ? S.reviewTopicCurrent(
                    reviewing.topic ? topicName(reviewing.topic) : S.topicNone,
                  )
                : S.reviewCurrent(
                    reviewing.label ? labels[reviewing.label] : S.unanalysed,
                  )}
            </p>
            <div className="db-review-history" data-testid="review-history">
              <h4>{S.reviewHistoryTitle}</h4>
              {reviewing.reviews.length === 0 &&
              reviewing.topic_reviews.length === 0 ? (
                <p className="db-muted">{S.reviewHistoryEmpty}</p>
              ) : (
                <ol className="db-history">
                  {reviewHistory(reviewing).map(({ review: r, state }, i) => (
                    <li key={`${r.created_at}-${i}`}>
                      <strong>
                        {S.reviewKindSentiment}: {labels[r.label]}
                      </strong>
                      <span>{displayDate(r.created_at, lang)}</span>
                      <span data-testid="review-by">
                        {r.reviewer_id ?? S.reviewerUnknown}
                      </span>
                      <small data-state={state}>
                        {S.reviewStateMessages[state]}
                      </small>
                      {r.reason && (
                        <q data-testid="review-reason">{r.reason}</q>
                      )}
                    </li>
                  ))}
                  {/* The topic verdicts, under the same in-force rule.
                      reviewHistory reads only origin, hash and date, so a
                      topic review passes through it with its key standing
                      where a label would; the cast is inert. */}
                  {reviewHistory({
                    reviews: reviewing.topic_reviews.map((r) => ({
                      ...r,
                      label: r.topic_key as Label,
                    })),
                    content_hash: reviewing.content_hash,
                  }).map(({ review: r, state }, i) => (
                    <li key={`topic-${r.created_at}-${i}`}>
                      <strong>
                        {S.reviewKindTopic}: {topicName(r.label)}
                      </strong>
                      <span>{displayDate(r.created_at, lang)}</span>
                      <span data-testid="review-by">
                        {r.reviewer_id ?? S.reviewerUnknown}
                      </span>
                      <small data-state={state}>
                        {S.reviewStateMessages[state]}
                      </small>
                      {r.reason && (
                        <q data-testid="review-reason">{r.reason}</q>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            {kind === "topic" ? (
              <Labelled
                id="review-topic-verdict"
                label={S.correctTopicLabel}
                value={topicVerdict}
                onValueChange={onTopicVerdict}
              >
                {topics
                  .filter((t) => !t.retired)
                  .map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {lang === "ar" ? t.name_ar : t.name_en}
                    </SelectItem>
                  ))}
              </Labelled>
            ) : (
              <Labelled
                id="review-verdict"
                label={S.correctLabel}
                value={verdict}
                onValueChange={(v) => onVerdict(v as Label)}
              >
                {Object.entries(labels).map(([key, text]) => (
                  <SelectItem key={key} value={key}>
                    {text}
                  </SelectItem>
                ))}
              </Labelled>
            )}
            <label>
              {S.correctionReason}
              <Input
                value={reason}
                onChange={(e) => onReason(e.target.value)}
                maxLength={500}
                required
              />
            </label>
            {error && (
              <p role="alert" data-testid="review-error">
                {error.message === "stale_comment_text"
                  ? S.reviewStale
                  : S.reviewSaveFailed}
              </p>
            )}
            <div className="db-review-actions">
              <Button type="submit" disabled={busy}>
                {S.saveCorrection}
              </Button>
              <Button
                variant="ghost"
                type="button"
                disabled={busy}
                onClick={onClose}
              >
                {S.cancel}
              </Button>
            </div>
            {!persisted && (
              <p className="db-muted" data-testid="review-scope">
                {S.reviewFixtureScope}
              </p>
            )}
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
