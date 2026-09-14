import { syncErrorMessages } from "./i18n";
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
function explain(code: string): string | null {
  const [head, ...rest] = code.split(":");
  const tail = rest.join(":");
  switch (head) {
    case "comments_disabled":
    case "explicitly_disabled":
      return "التعليقات مُعطَّلة على هذا الفيديو. لا شيء يمكن جمعه منه، وهذا إعداد في الفيديو نفسه لا خلل في الأداة.";
    case "no_upload_has_comments": {
      // `12_checked_0_disabled` — counts, not prose, so they are read out.
      const m = tail.match(/^(\d+)_checked_(\d+)_disabled$/);
      if (!m) return "لا يحمل أيٌّ من الفيديوهات المفحوصة تعليقات بعد.";
      const [, checked, disabled] = m;
      const off =
        Number(disabled) > 0
          ? ` ${disabled} منها التعليقات مغلقة عليه.`
          : " ولا واحد منها التعليقات مغلقة عليه — القناة هادئة فحسب.";
      return `فُحص ${checked} من أحدث الفيديوهات، ولا يحمل أيٌّ منها تعليقًا بعد.${off} الأداة تعمل؛ لا يوجد ما تقرؤه.`;
    }
    case "no_video_to_collect":
      return "لم يُعثر على فيديو صالح للجمع في هذه القناة.";
    case "channel_not_connected":
      return "لا توجد قناة مرتبطة بهذه المهمة. اربط قناة يوتيوب أولًا.";
    case "credential_expired":
      return "انتهت صلاحية الإذن الممنوح. أعد ربط القناة لتجديده.";
    case "quota_exceeded":
      return "استُنفدت حصة يوتيوب اليومية. تتجدد تلقائيًا، وتُعاد المحاولة بعدها.";
    case "source_access_denied":
      return tail === "insufficientPermissions"
        ? "الإذن الممنوح لا يكفي لقراءة التعليقات. أعد ربط القناة لتجديد النطاق."
        : `رفض يوتيوب الوصول${tail ? ` (${tail})` : ""}.`;
    case "superseded_by_existing_request":
      return "أُلغيت لأن طلبًا مطابقًا كان في الطابور بالفعل. طلب واحد لكل قناة في كل مرة.";
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
      return syncErrorMessages[head] ?? null;
  }
}

export function describeJob(
  job: JobRow,
  opts: { workerConnected: boolean },
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
  const reason = job.error_code ? explain(job.error_code) : null;
  // An unrecognised code is shown as itself rather than smoothed into a
  // reassuring sentence: an unexplained code is a question, and inventing an
  // explanation for it would be worse than admitting there isn't one.
  const fallback = job.error_code
    ? `رمز غير مفسَّر: ${job.error_code}`
    : "لم يُسجَّل سبب.";

  switch (job.status) {
    case "queued":
      return {
        ...base,
        severity: opts.workerConnected ? "warning" : "critical",
        headline: "في الانتظار",
        detail: opts.workerConnected
          ? "في الطابور، ولم يلتقطها عامل الجمع بعد."
          : "في الطابور، ولا يوجد عامل جمع يعمل الآن. لن تبدأ حتى يعمل واحد.",
      };
    case "running":
      return {
        ...base,
        severity: "ok",
        headline: "قيد التنفيذ",
        detail: "عامل الجمع يعمل على هذه المهمة الآن.",
      };
    case "succeeded":
      return {
        ...base,
        severity: "ok",
        headline: "اكتملت",
        // Deliberately not "جُمعت التعليقات": a run can end successfully having
        // read a video that has none, and claiming otherwise would put a
        // success next to an empty table.
        detail:
          "انتهت المهمة إلى نهايتها. عدد ما وصل يظهر في اللوحة، وقد يكون صفرًا إن لم يكن هناك تعليق.",
      };
    case "partial":
      return {
        ...base,
        severity: "warning",
        headline: "اكتملت جزئيًا",
        detail:
          `توقّفت قبل استيفاء المصدر، فما وُجد محفوظ وما تبقّى لم يُقرأ. ${reason ?? ""}`.trim(),
      };
    case "failed":
      return {
        ...base,
        severity: "critical",
        headline: "فشلت",
        detail: reason ?? fallback,
      };
    case "blocked":
      return {
        ...base,
        severity: "critical",
        headline: "متوقّفة",
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
        headline: "أُلغيت",
        detail: reason ?? fallback,
      };
  }
}
