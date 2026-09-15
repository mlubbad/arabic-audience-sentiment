/**
 * Every sentence the interface says, in Arabic — the source of truth.
 *
 * Arabic is the language the product was written in and the one its tests
 * read, so it is the set the keys are derived from: `en.ts` is typed as a
 * complete translation of this object, and a key added here without an
 * English line fails `tsc`. Nothing falls back to a key name on screen.
 *
 * Counted things are functions, not templates. Arabic and English pluralise
 * differently enough — dual, paucal, the accusative after a number — that a
 * `{n}` placeholder would be wrong in one of them for every count.
 *
 * Grouped by the surface that reads them; the prefix is the group. Keep a
 * sentence in one place: two keys with the same text are the shape this
 * codebase treats as a bug.
 */

export const ar = {
  // ---- the shell: rail, announcement, session, not-found ----
  brand: "مشاعر الجمهور",
  brandOwner: "من سكاي ديفيلوب",
  brandHomeLabel: "مشاعر الجمهور — الرئيسية",
  skipToContent: "انتقل إلى المحتوى",
  announcementLead: "صوت جمهورك، بوضوح أكبر",
  announcementTag: "معاينة خاصة · نسخة تجريبية",
  menuLabel: "قائمة التطبيق",
  menuOpen: "القائمة ☰",
  menuClose: "إغلاق ×",
  navLabel: "التنقل الرئيسي",
  navCaption: "التنقّل",
  navOverview: "نظرة عامة",
  navOperations: "التشغيل",
  navAccount: "المصادر والحساب",
  titleOverview: "نظرة عامة",
  titleOperations: "حالة المزامنة",
  titleAccount: "الحساب ومساحات العمل",
  titleConnected: "نتيجة ربط القناة",
  titleNotFound: "صفحة غير موجودة",
  pageOpening: "جارٍ فتح الصفحة…",
  footerTagline: "من التعليق إلى صورة أوضح.",
  footerNote: "معاينة خاصة · بعض الصفحات تستخدم بيانات اصطناعية موضّحة بوضوح.",
  notFoundEyebrow: "هذه الصفحة غير متاحة",
  notFoundTitle: "لم نجد الصفحة التي تبحث عنها.",
  notFoundLead: "يمكنك العودة إلى اللوحة أو استكشاف الخدمة من الصفحة الرئيسية.",
  openDashboard: "فتح لوحة البيانات",
  backHome: "العودة للرئيسية",
  signIn: "تسجيل الدخول",
  yourAccount: "حسابك",
  signOut: "تسجيل الخروج",
  signingOut: "جارٍ الخروج…",
  signOutFailed: "تعذّر تسجيل الخروج",
  /** The switch names the other language, in that language. */
  switchToOther: "English",
  switchLabel: "تغيير لغة الواجهة",
} as const;

/** The shape a translation must fill: every key, strings as strings and
 *  counted sentences as functions of the same arity. */
export type Strings = {
  [K in keyof typeof ar]: (typeof ar)[K] extends string
    ? string
    : (typeof ar)[K];
};
