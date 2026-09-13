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
