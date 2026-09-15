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

  // ---- signing in and up (authMessages.ts, authProviders.ts) ----
  authInvalidCredentials:
    "البريد الإلكتروني أو كلمة المرور غير صحيحة، أو لا يوجد حساب بهذا البريد. لإنشاء حساب جديد اختر «إنشاء حساب».",
  authEmailNotConfirmed:
    "لم يُفعَّل هذا الحساب بعد. افتح رابط التأكيد المُرسَل إلى بريدك، ثم سجّل الدخول.",
  authUserExists:
    "هذا البريد مسجَّل بالفعل. اختر «تسجيل الدخول» بدل إنشاء حساب.",
  authWeakPassword: "كلمة المرور ضعيفة. استخدم ثمانية أحرف على الأقل.",
  authEmailInvalid: "صيغة البريد الإلكتروني غير مقبولة.",
  authEmailNotAuthorized: "هذا البريد غير مصرَّح له بالتسجيل في هذا المشروع.",
  authSignupDisabled: "إنشاء الحسابات معطَّل في هذا المشروع.",
  authEmailRateLimit:
    "أُرسلت رسائل كثيرة خلال وقت قصير. انتظر بضع دقائق ثم أعد المحاولة.",
  authRequestRateLimit:
    "محاولات كثيرة خلال وقت قصير. انتظر قليلاً ثم أعد المحاولة.",
  authValidationFailed: "البيانات المُدخلة غير مكتملة أو غير صالحة.",
  authUnknownError: (code: string) => `تعذر إتمام الطلب. رمز الخطأ: ${code}`,
  authSignedIn: "تم تسجيل الدخول.",
  authSignedUp:
    "أُنشئ الحساب. افتح رابط التأكيد المُرسَل إلى بريدك لتفعيله، ثم سجّل الدخول.",
  providerClosedGoogle: "الدخول عبر Google لم يُفعَّل بعد على هذا المشروع.",
  providerClosedAzure: "الدخول عبر Microsoft لم يُفعَّل بعد على هذا المشروع.",
  providerClosedSso: "الدخول الموحَّد للمؤسسات (SAML) لم يُفعَّل بعد.",

  // ---- connecting a channel (connect.ts) ----
  connectUnauthenticated: "سجّل الدخول أولًا لربط قناة.",
  connectForbidden: "لا تملك صلاحية ربط قناة في مساحة العمل هذه.",
  connectInvalidClient: "مساحة العمل هذه بلا عميل. أنشئ مساحة عمل جديدة.",
  connectNotConfigured: "ربط يوتيوب غير مهيّأ على هذا الخادم.",
  connectInvalidRequest: "بيانات الطلب ناقصة.",
  connectUnknownError: (code: string) => `تعذر بدء الربط. رمز الخطأ: ${code}`,
  serviceUnreachable: "تعذر الاتصال بالخدمة. حاول مجدداً.",

  // ---- the three steps (setup.ts) and the card (WorkspaceCard.tsx) ----
  stepWorkspace: "أنشئ حسابك ومساحة العمل الخاصة بك.",
  stepChannel: "اربط قناة يوتيوب بعد موافقتك على الإذن.",
  stepCollect: "اطلب الجمع، ثم تابع حالته ونتائجه في اللوحة.",
  stepChannelSeeded: "القناة مسجَّلة بلا إذن بعد؛ اربطها لتأكيد ملكيتها.",
  stepChannelLapsed: "القناة تحتاج إعادة ربط؛ الإذن السابق لم يعد صالحًا.",
  stepCollectPending: "الطلب قائم؛ تفاصيل التقدّم في صفحة التشغيل.",
  stepCollectFailed: "آخر محاولة لم تكتمل؛ السبب في صفحة التشغيل.",
  stepStateDone: "تم",
  stepStateNext: "الخطوة التالية",
  stepStateLater: "لاحقًا",
  stepStatePending: "قيد التنفيذ",
  stepStateAttention: "يحتاج انتباهك",
  stepsLabel: "خطوات الإعداد",
  channelConnected: "قناة مرتبطة: ",
  channelSeeded: "قناة عامة بلا إذن بعد: ",
  channelNeedsRelink: (status: string) =>
    `القناة تحتاج إعادة ربط (${status}): `,
  channelIdLabel: "المعرّف",
  channelNone: "لا توجد قناة مرتبطة بعد",
  requestSync: "طلب مزامنة",
  connectChannel: "ربط قناة يوتيوب",
  relinkForName: "إعادة الربط لحفظ اسم القناة",

  // ---- the gate (WorkspaceGate.tsx) ----
  gateResolvingAccount: "جارٍ تحديد حسابك…",
  gateLoadingWorkspaces: "جارٍ تحميل مساحات العمل…",
  gateWorkspacesFailedTitle: "تعذّرت قراءة مساحات عملك.",
  gateWorkspacesFailedLead:
    "حدّث الصفحة لإعادة المحاولة؛ لا يمكن عرض بيانات تجربة بدل بيانات حسابك.",
  gateNoWorkspaceTitle: "لا توجد مساحة عمل لهذا الحساب بعد.",
  gateCreateFromAccount: "أنشئ مساحة عمل من صفحة الحساب",
  workspaceLabel: "مساحة العمل",
  choosePlaceholder: "— اختر —",
  changeWorkspace: "تغيير مساحة العمل",
  gateOverviewEyebrow: "نظرة عامة",
  gateOverviewTitle: "أي مساحة عمل تريد قراءة تعليقاتها؟",
  gateOverviewLead:
    "لكل مساحة قناتها وتعليقاتها؛ لا تُعرض بيانات مساحة داخل أخرى.",
  gateOperationsEyebrow: "حالة الجمع",
  gateOperationsTitle: "أي مساحة عمل تريد متابعة تشغيلها؟",
  gateOperationsLead: "لكل مساحة حالة جمع وحدود خطة وسجل محاولات مستقل.",

  // ---- the plan card (planWords.ts) ----
  planNoneChosenKicker: "لم تُختر مساحة عمل",
  planNoneChosenTitle: "الحدود لكل مساحة",
  planNoneChosenNote: "اختر مساحة عمل لترى ما تبقّى من خطتها.",
  planKickerFallback: "مساحة العمل",
  planLoading: "جارٍ قراءة الخطة…",
  planFailedTitle: "تعذّرت قراءة الخطة",
  planFailedNote: "لا يعني ذلك نفاد الحد. حدّث الصفحة لإعادة المحاولة.",
  planNoneTitle: "لا خطة مفعّلة",
  planNoneNote: "يفعّل المشغّل الخطة يدويًا في هذه المرحلة.",
  planTitle: (key: string) => `خطة ${key}`,
  planExhausted: (name: string, allowance: string) =>
    `${name}: نفد الحد (${allowance})`,
  planRemaining: (name: string, remaining: string, allowance: string) =>
    `${name}: يتبقى ${remaining} من ${allowance}`,
  budgetAnalysis: "تحليل التعليقات",
  budgetBackfill: "استيراد تاريخي",

  // ---- the account page (Account.tsx) ----
  working: "جارٍ تنفيذ الطلب…",
  ssoNeedsDomain:
    "الدخول الموحَّد يحتاج نطاق مؤسستك — لم تُبنَ هذه الشاشة بعد.",
  providerStartFailed: "تعذّر بدء الدخول عبر هذا المزوّد.",
  sessionReadFailed: "تعذر قراءة جلسة الحساب",
  workspacesLoadFailed: "تعذر تحميل مساحات العمل",
  accountEyebrow: "الحساب",
  accountTitle: "الحساب ومساحات العمل",
  accountLead: "مساحات عملك، وقنواتها، وحالة إعداد كلٍّ منها.",
  accountUnavailableTitle: "تسجيل الدخول غير متاح في هذه المعاينة",
  accountUnavailableLead:
    "يلزم عنوان مشروع تطوير ومفتاح نشر عام لتفعيل الحساب. لا تُستخدم بيانات الاختبار كجلسة دخول.",
  accountTryDashboardTitle: "ابدأ من تجربة اللوحة",
  accountTryDashboardLead:
    "يمكنك استكشاف الواجهة ببيانات اصطناعية واضحة المصدر.",
  createWorkspaceFailed: "تعذر إنشاء مساحة العمل",
  createWorkspaceListFailed: "تم الإنشاء وتعذر تحديث القائمة",
  createWorkspaceDone: "تم إنشاء مساحة العمل",
  authJoinTitle: "أنشئ حسابك",
  authReturnTitle: "مرحبًا بعودتك",
  authJoinLead: "معاينة خاصة — الحساب يفتح مساحة عمل واحدة تخصّك.",
  authReturnLead: "ادخل إلى مساحة عملك وقنواتك وتقاريرك.",
  emailLabel: "البريد الإلكتروني",
  passwordLabel: "كلمة المرور",
  createAccount: "إنشاء حساب جديد",
  orJoinWith: "أو أنشئ حسابًا بـ",
  orSignInWith: "أو ادخل بـ",
  haveAccount: "لديك حساب بالفعل؟",
  noAccount: "لا تملك حسابًا؟",
  joinLink: "أنشئ حسابًا",
  howToStartEyebrow: "كيف تبدأ؟",
  howToStartTitle: "من قناتك إلى قراءة أوضح.",
  howToStartLead: "ثلاث خطوات تفصل حسابك عن لوحة تعبّر عما جُمع فعلًا.",
  trustTitle: "ما يضمنه هذا البناء",
  trustIsolationStrong: "مساحتك لا تُقرأ من مساحة أخرى.",
  trustIsolation:
    " العزل مفروض في قاعدة البيانات نفسها، ومُختبَر بطلبات مباشرة لا بإخفاء أزرار.",
  trustCountedStrong: "الأرقام معدودة لا مقدَّرة.",
  trustCounted:
    " كل رقم محسوب من الصفوف المحفوظة؛ وما لا يُعرف يُقال «غير معروف» ولا يُحسب صفرًا.",
  trustMeasuredStrong: "النموذج مُقاس لا مُدّعى.",
  trustMeasured:
    " قِيست ستة مصنّفات عربية على مجموعة موسومة يدويًا، ونتائجها منشورة في المستودع — بما فيها أن أيًّا منها لم يتجاوز بوّابة الدقّة.",
  trustReviewStrong: "تصحيحك يعلو على النموذج.",
  trustReview:
    " المراجعة البشرية تُلغي تنبؤ النموذج لذلك النص، وتُحفظ باسم صاحبها وسببها.",
  trustNote:
    "معاينة خاصة. لا نعرض عدد عملاء ولا شعارات: لا يوجد ما نعدّه بعد، ورقمٌ مُختلَق على الباب يُفسد ما تقوله اللوحة خلفه.",
  insideAccount: "أنت داخل حسابك. اختر مساحة العمل التي تريد إدارتها.",
  workspacesTitle: "مساحات العمل",
  workspacesLead:
    "كل مساحة عمل تملك قناتها وبياناتها وحدودها. لا تُعرض بيانات مساحة داخل أخرى.",
  noWorkspaceStrong: "لا توجد مساحة عمل متاحة",
  noWorkspaceLead: "أنشئ واحدة أدناه لتبدأ.",
  syncRequestFailed: "تعذر تسجيل طلب المزامنة.",
  syncRequestStanding:
    "طلب المزامنة قائم. لكل قناة طلب واحد في كل مرة، ولن يبدأ حتى يعمل عامل الجمع — التفاصيل في صفحة «حالة المزامنة».",
  anotherWorkspaceTitle: "مساحة أخرى لعميل أو قناة",
  anotherWorkspaceLead: "يبقى لكل مساحة جمهورها وبياناتها وصلاحياتها المستقلة.",
  workspaceNameLabel: "اسم مساحة العمل",
  createWorkspace: "إنشاء مساحة عمل",
} as const;

/** The shape a translation must fill: every key, strings as strings and
 *  counted sentences as functions of the same arity. */
export type Strings = {
  [K in keyof typeof ar]: (typeof ar)[K] extends string
    ? string
    : (typeof ar)[K];
};
