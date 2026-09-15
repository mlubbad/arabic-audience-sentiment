import type { Strings } from "./strings";
/**
 * What one collection job actually did, said in words the operator can act on.
 *
 * The job table stores a status and a machine code. Neither is an answer on its
 * own: "blocked / comments_disabled" and "blocked / no_upload_has_comments"
 * both mean nothing was collected, but the first is a setting on a video and
 * the second is a channel nobody has commented on yet. Showing the raw code
 * makes the operator guess; showing only "لم تُجمع تعليقات" hides the
 * difference entirely.
 *
 * A queued job with no worker running is called out as waiting rather than as
 * progress, because on screen those look identical and only one of them is
 * going to finish.
 *
 * Pure on purpose: every branch here is a state that is tedious to reproduce
 * against a live channel, and each one is a sentence a real person reads.
 */

export type JobRow = {
  id: string;
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "partial"
    | "failed"
    | "blocked"
    | "cancelled";
  attempt: number;
  error_code: string | null;
  created_at: string;
};

export type JobEntry = {
  id: string;
  severity: "ok" | "warning" | "critical" | "muted";
  /** The state, in two or three words. */
  headline: string;
  /** What it means, and what the operator can do about it. */
  detail: string;
  attempt: number;
  createdAt: string;
  /** Queued work can be withdrawn; a leased job belongs to its worker. */
  cancellable: boolean;
  /** Finished without success — worth another attempt. */
  retryable: boolean;
};

/**
 * The code is a prefix plus detail, colon-separated: `source_access_denied:
 * insufficientPermissions`. Splitting on the first colon keeps the specific
 * part available instead of throwing it away with a `startsWith` match.
 */
/**
 * One code, one sentence, for every surface that shows one.
 *
 * Exported because the health panel used to do its own flat lookup in
 * `syncErrorMessages` — which is the same one-meaning-two-implementations
 * shape that put two disagreeing tables on one screen, and it broke the moment
 * a code carried a parameter: `retry_exhausted:no_error_recorded` is not a key
 * in that table, so the panel fell through to "لسبب غير مصنَّف" and lost the
 * part that mattered.
 */
export function explainCode(code: string, S: Strings): string | null {
  return explain(code, S);
}

function explain(code: string, S: Strings): string | null {
  const [head, ...rest] = code.split(":");
  const tail = rest.join(":");
  switch (head) {
    case "comments_disabled":
    case "explicitly_disabled":
      return S.jobCommentsDisabled;
    case "no_upload_has_comments": {
      // `12_checked_0_disabled` — counts, not prose, so they are read out.
      const m = tail.match(/^(\d+)_checked_(\d+)_disabled$/);
      if (!m) return S.jobNoUploadHasComments;
      const [, checked, disabled] = m;
      return S.jobNoUploadHasCommentsCounted(checked, Number(disabled));
    }
    case "no_video_to_collect":
      return S.jobNoVideo;
    case "channel_not_connected":
      return S.jobChannelNotConnected;
    case "credential_expired":
      return S.jobCredentialExpired;
    case "quota_exceeded":
      return S.jobQuotaExceeded;
    case "source_access_denied":
      // The switch may only override the table where it has something *more*
      // specific to say. Its bare branch said less — "رفض يوتيوب الوصول."
      // against the table's "رفض المصدر الوصول، غالبًا بسبب الحصة أو
      // الصلاحيات" — so unifying the two readers quietly dropped the half that
      // tells the operator where to look. A parameter is what earns the
      // override; without one, the table's wording stands.
      if (tail === "insufficientPermissions")
        return S.jobInsufficientPermissions;
      if (tail) return S.jobAccessDeniedWith(tail);
      return S.syncErrorMessages.source_access_denied;
    case "superseded_by_existing_request":
      return S.jobSuperseded;
    case "retry_exhausted": {
      // The distinction the operator most needs, and the one a flat table
      // cannot carry. "Exhausted with no reason recorded" does not mean the
      // work failed — it means no worker ever reported anything, which is what
      // a job taken from a worker that was still running looks like. Restarting
      // the worker is the wrong response to it.
      if (!tail || tail === "no_error_recorded")
        return S.jobRetryExhaustedNoReason;
      const why = explain(tail, S);
      return S.jobRetryExhausted(why ?? tail);
    }
    case "lease_thrashing":
      // Not a slow job. A job nothing can hold, which is a different problem
      // and deserves a different word.
      return S.jobLeaseThrashing(tail || S.jobLeaseThrashingRepeatedly);
    default:
      // The shared table, before giving up.
      //
      // This switch and `syncErrorMessages` were two tables for one meaning,
      // and they disagreed on screen: the health panel above the attempts log
      // rendered `retry_exhausted` as "استُنفدت المحاولات المسموح بها" while
      // the log underneath it called the same code uninterpreted. The switch
      // exists for codes that carry parameters a flat table cannot hold —
      // `no_upload_has_comments:12_checked_0_disabled` — so it stays, and
      // everything it does not recognise now asks the table that does.
      return (S.syncErrorMessages as Record<string, string>)[head] ?? null;
  }
}

export function describeJob(
  job: JobRow,
  opts: { workerConnected: boolean },
  S: Strings,
): JobEntry {
  const base = {
    id: job.id,
    attempt: job.attempt,
    createdAt: job.created_at,
    // Mirrors what cancel_job and retry_job will accept. The database decides;
    // this only avoids offering a button that is going to be refused.
    cancellable: job.status === "queued",
    retryable: ["failed", "blocked", "cancelled", "partial"].includes(
      job.status,
    ),
  };
  const reason = job.error_code ? explain(job.error_code, S) : null;
  // An unrecognised code is shown as itself rather than smoothed into a
  // reassuring sentence: an unexplained code is a question, and inventing an
  // explanation for it would be worse than admitting there isn't one.
  const fallback = job.error_code
    ? S.jobUnexplainedCode(job.error_code)
    : S.jobNoReason;

  switch (job.status) {
    case "queued":
      return {
        ...base,
        severity: opts.workerConnected ? "warning" : "critical",
        headline: S.jobQueuedHeadline,
        detail: opts.workerConnected
          ? S.jobQueuedWithWorker
          : S.jobQueuedNoWorker,
      };
    case "running":
      return {
        ...base,
        severity: "ok",
        headline: S.jobRunningHeadline,
        detail: S.jobRunningDetail,
      };
    case "succeeded":
      return {
        ...base,
        severity: "ok",
        headline: S.jobSucceededHeadline,
        // Deliberately not "جُمعت التعليقات": a run can end successfully having
        // read a video that has none, and claiming otherwise would put a
        // success next to an empty table.
        detail: S.jobSucceededDetail,
      };
    case "partial":
      return {
        ...base,
        severity: "warning",
        headline: S.jobPartialHeadline,
        detail: `${S.jobPartialDetail} ${reason ?? ""}`.trim(),
      };
    case "failed":
      return {
        ...base,
        severity: "critical",
        headline: S.jobFailedHeadline,
        detail: reason ?? fallback,
      };
    case "blocked":
      return {
        ...base,
        severity: "critical",
        headline: S.jobBlockedHeadline,
        detail: reason ?? fallback,
      };
    case "cancelled":
      return {
        ...base,
        // A supersede is bookkeeping, not a problem to look into.
        severity:
          job.error_code === "superseded_by_existing_request"
            ? "muted"
            : "warning",
        headline: S.jobCancelledHeadline,
        detail: reason ?? fallback,
      };
  }
}
