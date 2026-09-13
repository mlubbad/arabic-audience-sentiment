/**
 * What this screen is showing, and where it came from.
 *
 * The dashboard used to state three things as fixed text: that the data is
 * synthetic, that no channel is connected, and that corrections are never sent
 * anywhere. All three are false in live mode, and the third is the dangerous
 * one — it would tell someone their correction stayed in the browser at the
 * moment it was written to the server.
 *
 * So none of it is written by hand any more. Every sentence is derived from the
 * same values that decide the behaviour, which is the only way the label and the
 * truth cannot drift apart.
 */
import type { SyncState } from "./syncHealth";
import { syncHealth } from "./syncHealth";
import type { DataMode } from "./data";

/**
 * Grouped digits, pinned to one locale on purpose.
 *
 * toLocaleString("ar") renders Arabic-Indic digits where full ICU data is
 * available and Latin where it is not, so the same build would show different
 * numerals on different machines. The rest of this interface uses Latin digits,
 * and one component quietly disagreeing is worse than either choice made
 * consistently.
 */
const count = (n: number) => n.toLocaleString("en-US");

export type SourceDescription = {
  mode: DataMode;
  /** Short badge: what kind of data this is. */
  badge: string;
  /** Whose data, in the user's terms. */
  scope: string;
  /** What was collected, never overstating completeness. */
  coverage: string;
  /** Whether a correction made here is saved anywhere. */
  persistence: string;
  /** How current the collection is. Null when the question does not apply. */
  freshness: string | null;
  /** Drives the visual treatment; not a severity judgement of the data itself. */
  tone: "neutral" | "warning";
};

function coverageSentence(sync: SyncState | null): string {
  const run = sync?.last_run;
  if (!run) return "لم تُسجَّل بعد أي عملية جمع لهذه المساحة.";
  const { comments_collected, videos_seen, complete } = run.coverage;
  const counted = `${count(comments_collected)} تعليقًا من ${count(videos_seen)} فيديو`;
  // "Complete" means the source was read to its end, never that every comment
  // that exists was retrieved. Saying "all comments" would be a claim nobody
  // can support.
  return complete
    ? `${counted}. قُرئ المصدر حتى نهايته في آخر عملية جمع.`
    : `${counted}. لم يُقرأ المصدر حتى نهايته، فالتغطية جزئية.`;
}

function freshnessSentence(sync: SyncState | null, now: Date): string {
  const health = syncHealth(sync, now);
  if (health.key === "no_data" || health.key === "never_run")
    return "لا توجد عملية جمع سابقة.";
  if (health.staleHours === null) return "حالة الجمع غير معروفة.";
  const hours = Math.round(health.staleHours);
  if (hours < 1) return "آخر تحديث قبل أقل من ساعة.";
  return `آخر تحديث قبل ${count(hours)} ساعة.`;
}

export function describeSource(input: {
  mode: DataMode;
  workspaceId: string;
  persisted: boolean;
  sync: SyncState | null;
  /** Null while the snapshot has not been read. Not zero — see below. */
  total: number | null;
  now: Date;
}): SourceDescription {
  const { mode, workspaceId, persisted, sync, total, now } = input;
  // The strip is shown beside the title from the first paint, before any data
  // has arrived. "Not read yet" and "read, and empty" are different answers, and
  // rendering a zero here would give the second when the first is true.
  const unread = total === null;
  if (mode === "sanitized_fixture")
    return {
      mode,
      badge: "بيانات اصطناعية",
      scope: "مساحة عمل تجريبية، غير مرتبطة بأي قناة",
      coverage: unread
        ? "جارٍ قراءة بيانات الاختبار."
        : `${count(total)} تعليقًا مؤلَّفًا للاختبار. لا يمثل أي جمهور حقيقي.`,
      // Keyed on the same flag the write path uses, so it cannot say one thing
      // while the code does another.
      persistence: persisted
        ? "التصحيحات تُحفظ."
        : "التصحيحات تبقى في هذه الجلسة فقط ولا تُرسل إلى أي خادم.",
      freshness: null,
      tone: "warning",
    };

  return {
    mode,
    badge: "بيانات مباشرة",
    scope: `مساحة العمل ${workspaceId}`,
    coverage: unread ? "جارٍ قراءة البيانات." : coverageSentence(sync),
    persistence: persisted
      ? "التصحيحات تُحفظ في سجل المراجعة ولا يمكن تعديلها بعد الحفظ."
      : "التصحيحات لا تُحفظ.",
    freshness: unread ? null : freshnessSentence(sync, now),
    tone: "neutral",
  };
}
