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
