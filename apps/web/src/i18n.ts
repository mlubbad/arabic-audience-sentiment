export const labels = {
  positive: "إيجابي",
  negative: "سلبي",
  neutral: "محايد",
  mixed: "مختلط",
};
export const locale = {
  language: "ar",
  direction: "rtl",
  timezone: "Asia/Istanbul",
} as const;
export function displayDate(date: string | null) {
  return date
    ? new Intl.DateTimeFormat("ar", {
        timeZone: locale.timezone,
        dateStyle: "medium",
      }).format(new Date(date))
    : "تاريخ غير معروف";
}
export const budgetNames: Record<string, string> = {
  comment_analysis: "تحليل التعليقات",
  historical_backfill: "استيراد تاريخي",
};
export const budgetMessages: Record<string, string> = {
  ok: "ضمن الحد",
  warning: "اقترب الاستهلاك من الحد",
  critical: "الاستهلاك قارب النفاد",
  exhausted:
    "نفد الحد؛ لن تُحلَّل دفعات جديدة حتى تُرفع الخطة أو تبدأ فترة جديدة",
};
export const reviewStateMessages: Record<string, string> = {
  in_force: "سارية: هذه هي النتيجة المعتمدة حاليًا",
  superseded_by_review: "حلّت محلها مراجعة أحدث",
  superseded_by_edit: "لا تنطبق بعد تغيّر النص؛ تحتاج إعادة تدقيق",
  legacy_unverified: "تعديل موروث غير موثق؛ لا يُحتسب مراجعة بشرية",
};
const fixtureVideoNames: Record<string, string> = {
  "video-1": "فيديو اصطناعي ١",
  "video-2": "فيديو اصطناعي ٢",
};
/** Falls back to the identifier rather than guessing a name. */
export function videoLabel(id: string) {
  return fixtureVideoNames[id] ?? id;
}
export const syncMessages: Record<string, string> = {
  healthy: "آخر مزامنة اكتملت حديثًا",
  running: "مزامنة قيد التنفيذ الآن؛ النتيجة غير معروفة بعد",
  stale: "مضى وقت طويل على آخر مزامنة؛ قد تكون البيانات قديمة",
  partial: "آخر مزامنة توقفت قبل نهايتها؛ التغطية جزئية وليست اكتمالًا",
  incomplete_coverage:
    "انتهى المصدر دون إثبات التغطية الكاملة؛ لا يعني ذلك جمع كل التعليقات",
  failed: "فشلت آخر مزامنة",
  blocked: "تعذّر الوصول إلى المصدر في آخر مزامنة",
  stalled: "توجد مهام منتظرة ولا يوجد عامل متصل لتنفيذها",
  never_run: "لم تُنفذ أي مزامنة بعد",
  never_run_no_worker: "لم تُنفذ أي مزامنة، ولا يوجد عامل متصل",
  no_data: "لا تتوفر بيانات عن حالة المزامنة",
};
