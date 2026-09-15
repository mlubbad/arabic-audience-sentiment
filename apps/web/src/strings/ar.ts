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

  // ---- code tables (i18n.ts): sentiment, budgets, review states, sync ----
  labels: {
    positive: "إيجابي",
    negative: "سلبي",
    neutral: "محايد",
    mixed: "مختلط",
  },
  budgetMessages: {
    ok: "ضمن الحد",
    warning: "اقترب الاستهلاك من الحد",
    critical: "الاستهلاك قارب النفاد",
    exhausted:
      "نفد الحد؛ لن تُحلَّل دفعات جديدة حتى تُرفع الخطة أو تبدأ فترة جديدة",
  },
  reviewStateMessages: {
    in_force: "سارية: هذه هي النتيجة المعتمدة حاليًا",
    superseded_by_review: "حلّت محلها مراجعة أحدث",
    superseded_by_edit: "لا تنطبق بعد تغيّر النص؛ تحتاج إعادة تدقيق",
    legacy_unverified: "تعديل موروث غير موثق؛ لا يُحتسب مراجعة بشرية",
  },
  syncMessages: {
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
  },
  /** Known collector failures in plain words. The raw code stays visible as
   *  supporting detail, so support can act on it without the reader decoding it. */
  syncErrorMessages: {
    source_access_denied: "رفض المصدر الوصول، غالبًا بسبب الحصة أو الصلاحيات",
    source_unavailable: "المصدر غير متاح مؤقتًا",
    source_http_error: "رد المصدر بخطأ غير متوقع",
    invalid_response: "وصل رد غير صالح من المصدر",
    network_failure: "تعذّر الاتصال بالمصدر",
    source_ended_without_completion: "انتهى المصدر قبل اكتمال الجمع",
    repeated_page_token: "تكرّر مؤشر الصفحة، فأُوقف الجمع لتفادي حلقة لا تنتهي",
    retry_exhausted: "استُنفدت المحاولات المسموح بها",
  },
  unknownDate: "تاريخ غير معروف",
  fixtureVideo: (n: string) => `فيديو اصطناعي ${n}`,
  purgedText: "[حُذف النص بعد انتهاء مدة الاحتفاظ]",
  purgedAuthor: "[غير محتفظ به]",
  weekdays: [
    "الأحد",
    "الاثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت",
  ],

  // ---- the attempts log (jobFeed.ts) ----
  jobCommentsDisabled:
    "التعليقات مُعطَّلة على هذا الفيديو. لا شيء يمكن جمعه منه، وهذا إعداد في الفيديو نفسه لا خلل في الأداة.",
  jobNoUploadHasComments: "لا يحمل أيٌّ من الفيديوهات المفحوصة تعليقات بعد.",
  jobNoUploadHasCommentsCounted: (checked: string, disabled: number) =>
    `فُحص ${checked} من أحدث الفيديوهات، ولا يحمل أيٌّ منها تعليقًا بعد.${
      disabled > 0
        ? ` ${disabled} منها التعليقات مغلقة عليه.`
        : " ولا واحد منها التعليقات مغلقة عليه — القناة هادئة فحسب."
    } الأداة تعمل؛ لا يوجد ما تقرؤه.`,
  jobNoVideo: "لم يُعثر على فيديو صالح للجمع في هذه القناة.",
  jobChannelNotConnected:
    "لا توجد قناة مرتبطة بهذه المهمة. اربط قناة يوتيوب أولًا.",
  jobCredentialExpired: "انتهت صلاحية الإذن الممنوح. أعد ربط القناة لتجديده.",
  jobQuotaExceeded:
    "استُنفدت حصة يوتيوب اليومية. تتجدد تلقائيًا، وتُعاد المحاولة بعدها.",
  jobInsufficientPermissions:
    "الإذن الممنوح لا يكفي لقراءة التعليقات. أعد ربط القناة لتجديد النطاق.",
  jobAccessDeniedWith: (reason: string) => `رفض يوتيوب الوصول (${reason}).`,
  jobSuperseded:
    "أُلغيت لأن طلبًا مطابقًا كان في الطابور بالفعل. طلب واحد لكل قناة في كل مرة.",
  jobRetryExhaustedNoReason:
    "بلغت الحدّ دون أن يسجّل أي عامل سببًا. هذا ليس فشلًا في الجمع: هكذا تبدو مهمّة انتُزعت من عامل كان يعمل. افحص مدّة الحيازة قبل أن تعيد تشغيل العامل.",
  jobRetryExhausted: (why: string) =>
    `بلغت الحدّ المسموح. آخر سبب سجّله عامل: ${why}`,
  jobLeaseThrashing: (times: string) =>
    `تغيّرت يد هذه المهمة ${times} مرّة دون أن تُنهى. ليست بطيئة؛ لا شيء يقدر على إمساكها — افحص العامل نفسه لا مدّة الحيازة.`,
  jobLeaseThrashingRepeatedly: "مرارًا",
  jobUnexplainedCode: (code: string) => `رمز غير مفسَّر: ${code}`,
  jobNoReason: "لم يُسجَّل سبب.",
  jobQueuedHeadline: "في الانتظار",
  jobQueuedWithWorker: "في الطابور، ولم يلتقطها عامل الجمع بعد.",
  jobQueuedNoWorker:
    "في الطابور، ولا يوجد عامل جمع يعمل الآن. لن تبدأ حتى يعمل واحد.",
  jobRunningHeadline: "قيد التنفيذ",
  jobRunningDetail: "عامل الجمع يعمل على هذه المهمة الآن.",
  jobSucceededHeadline: "اكتملت",
  jobSucceededDetail:
    "انتهت المهمة إلى نهايتها. عدد ما وصل يظهر في اللوحة، وقد يكون صفرًا إن لم يكن هناك تعليق.",
  jobPartialHeadline: "اكتملت جزئيًا",
  jobPartialDetail:
    "توقّفت قبل استيفاء المصدر، فما وُجد محفوظ وما تبقّى لم يُقرأ.",
  jobFailedHeadline: "فشلت",
  jobBlockedHeadline: "متوقّفة",
  jobCancelledHeadline: "أُلغيت",

  // ---- the connection result (connectResult.ts, Connected.tsx) ----
  crDeclined:
    "لم تُمنح الصلاحية، فلم يُربط شيء ولم يُحفظ أي رمز. يمكنك المحاولة مرة أخرى متى شئت.",
  crApiNotEnabled:
    "واجهة YouTube Data API v3 غير مفعّلة في مشروع Google Cloud الخاص بك. فعّلها ثم أعد المحاولة؛ الموافقة التي منحتها الآن لا تكفي وحدها.",
  crScopeMissing:
    "الصلاحية الممنوحة لا تشمل قراءة بيانات يوتيوب. أعد المحاولة واقبل الطلب كاملًا.",
  crQuotaExceeded:
    "استُهلكت حصة يوتيوب اليومية. تعود غدًا، وعندها أعد المحاولة.",
  crNoChannel:
    "لا توجد قناة يوتيوب على هذا الحساب. سجّل الدخول بحساب Google الذي يملك القناة.",
  crAmbiguousChannel:
    "هذا الحساب يملك أكثر من قناة، ولا نختار نيابة عنك. اختر حساب قناة واحدة.",
  crNoRefreshToken:
    "لم تمنح Google صلاحية متجددة، والجمع يحتاجها ليستمر بعد إغلاق المتصفح. أعد المحاولة واقبل الطلب كاملًا.",
  crInvalidState:
    "انتهت صلاحية طلب الربط أو استُخدم من قبل. ابدأ من جديد؛ هذا القيد هو ما يمنع إعادة استخدام رابط قديم.",
  crInvalidCallback: "الرابط الذي عدت به غير مكتمل. ابدأ الربط من جديد.",
  crAlreadyConnected: "هذه القناة مرتبطة بمساحة عمل أخرى. افصلها هناك أولًا.",
  crConnectedHeading: "تم ربط القناة",
  crConnectedDetail: "القناة متصلة الآن. سيبدأ الجمع في أول مزامنة.",
  crConnectedDetailWith: (channel: string) =>
    `القناة متصلة الآن. سيبدأ الجمع في أول مزامنة (${channel}).`,
  crIncompleteHeading: "لم يكتمل الربط",
  crFailedHeading: "تعذر إتمام الربط",
  crUnknownDetail: (code: string) => `تعذر إتمام الطلب. رمز الخطأ: ${code}`,
  connectedEyebrow: "ربط قناة يوتيوب",
  enableApiLink: "افتح صفحة تفعيل YouTube Data API",
  backToAccount: "العودة إلى الحساب",

  // ---- the data source strip (dataSource.ts) ----
  dsNoRun: "لم تُسجَّل بعد أي عملية جمع لهذه المساحة.",
  dsCounted: (comments: string, videos: string) =>
    `${comments} تعليقًا من ${videos} فيديو`,
  dsCoverageComplete: (counted: string) =>
    `${counted}. قُرئ المصدر حتى نهايته في آخر عملية جمع.`,
  dsCoveragePartial: (counted: string) =>
    `${counted}. لم يُقرأ المصدر حتى نهايته، فالتغطية جزئية.`,
  dsNoPreviousRun: "لا توجد عملية جمع سابقة.",
  dsHealthUnknown: "حالة الجمع غير معروفة.",
  dsUpdatedUnderHour: "آخر تحديث قبل أقل من ساعة.",
  dsUpdatedHours: (hours: string) => `آخر تحديث قبل ${hours} ساعة.`,
  dsFixtureBadge: "بيانات اصطناعية",
  dsFixtureScope: "مساحة عمل تجريبية، غير مرتبطة بأي قناة",
  dsFixtureReading: "جارٍ قراءة بيانات الاختبار.",
  dsFixtureCoverage: (total: string) =>
    `${total} تعليقًا مؤلَّفًا للاختبار. لا يمثل أي جمهور حقيقي.`,
  dsReviewsPersist: "التصحيحات تُحفظ.",
  dsReviewsSessionOnly:
    "التصحيحات تبقى في هذه الجلسة فقط ولا تُرسل إلى أي خادم.",
  dsLiveBadge: "بيانات مباشرة",
  dsWorkspaceById: (id: string) => `مساحة العمل ${id}`,
  dsReadingLive: "جارٍ قراءة البيانات.",
  dsReviewsLogged:
    "التصحيحات تُحفظ في سجل المراجعة ولا يمكن تعديلها بعد الحفظ.",
  dsReviewsNotSaved: "التصحيحات لا تُحفظ.",

  // ---- the operations page (Sync.tsx) ----
  opsEyebrow: "التشغيل",
  opsTitle: "حالة الجمع والتحليل",
  opsSignedOutLead:
    "هذه الصفحة تتبع تشغيل قناتك: نشاط الجمع، وحدود خطتك، وسجل كل محاولة وسببها. كلها تخص حسابًا وقناة مرتبطة به، فلا يوجد ما تتابعه قبل تسجيل الدخول.",
  opsSignInOrJoin: "سجّل الدخول أو أنشئ حسابًا",
  opsSeeDemo: "شاهد كيف تبدو هذه الصفحة",
  opsLead:
    "ما تراه هنا يصف تشغيل الخدمة؛ تعليقات الجمهور وتفسيرها في لوحة البيانات.",
  opsDemoTag: "معاينة تجريبية",
  opsWorkspaceData: "بيانات التشغيل لمساحة",
  opsDemoNote: "بيانات تشغيل اصطناعية للتجربة، غير مرتبطة بقناة حقيقية.",
  opsReading: "جارٍ قراءة حالة التشغيل…",
  opsReadFailed: "تعذّرت قراءة حالة التشغيل.",
  retry: "إعادة المحاولة",
  opsHealthTitle: "صحة المزامنة",
  opsUnclassifiedFailure: "تعذّرت المزامنة لسبب غير مصنَّف",
  opsQueued: (n: number) => `مهام منتظرة: ${n}`,
  opsWorkerLabel: "العامل:",
  opsWorkerConnected: (heartbeat: string) => `متصل، آخر نبضة ${heartbeat}`,
  opsWorkerDisconnected:
    "غير متصل الآن. لن تُحدَّث البيانات تلقائيًا حتى يعود عامل الجمع.",
  opsRequesting: "جارٍ الطلب…",
  opsNoChannelBefore: "لا توجد قناة مرتبطة بمساحة العمل هذه.",
  opsNoChannelLink: "اربط قناة من صفحة الحساب",
  opsNoChannelAfter: "ليبدأ الجمع.",
  opsLastRun: (at: string, source: string, videos: number, comments: number) =>
    `آخر تشغيل: ${at} — المصدر ${source} — فيديوهات ${videos}، تعليقات ${comments}.`,
  opsTraversalComplete: "اكتمل اجتياز المصدر.",
  opsTraversalUnproven: "لم يُثبت اجتياز المصدر بالكامل.",
  opsNoPreviousRun: "لا يوجد تشغيل سابق مسجَّل.",
  opsPlanTitle: "حدود الخطة",
  opsNoPlanStrong: "لا توجد خطة مفعّلة لمساحة العمل هذه",
  opsNoPlanLead:
    "يفعّل المشغّل الخطة يدويًا في هذه المرحلة، ولا يعني ذلك نفاد الحد.",
  opsPlanPeriod: (key: string, from: string, to: string) =>
    `الخطة ${key} — الفترة من ${from} حتى ${to} بتوقيت UTC.`,
  opsBudgetLine: (used: number, allowance: number, remaining: number) =>
    `${used} من ${allowance} — يتبقى ${remaining}`,
  opsShare: (share: number, message: string) => `${share}٪ — ${message}`,
  opsAttemptsTitle: "سجل المحاولات",
  opsAttemptsLead: "كل محاولة جمع بترتيب زمني عكسي، ومعها سبب ما حدث.",
  opsDemoNoLogStrong: "العرض التجريبي لا يحمل سجل مهام",
  opsDemoNoLogLead:
    "المهام تخص حسابًا حقيقيًا وقناة مرتبطة. لن يُعرض هنا سجل مُختلق ليبدو المكان ممتلئًا.",
  opsLogFailedStrong: "تعذّرت قراءة سجل المهام",
  opsLogFailedLead: "هذا ليس معناه أنه فارغ.",
  opsLogReading: "جارٍ قراءة سجل المحاولات…",
  opsNoAttemptsStrong: "لا توجد محاولات بعد",
  opsNoAttemptsLead: "اطلب مزامنة من صفحة الحساب.",
  opsAttemptN: (n: number) => ` · المحاولة ${n}`,
  opsCancel: "سحب من الطابور",
  refresh: "تحديث",
  opsCancelFailed: "تعذّر سحب المهمة — قد يكون عامل قد بدأها بالفعل.",
  opsRetryFailed: "تعذّرت إعادة المحاولة.",
  opsCancelled: "سُحبت المهمة من الطابور.",
  opsRetried: "أُضيفت محاولة جديدة، تستأنف من حيث توقّفت السابقة.",
  opsSyncRequestFailed: "تعذّر تسجيل طلب المزامنة.",
  opsSyncRequestStanding:
    "طلب المزامنة قائم. لكل قناة طلب واحد في كل مرة، ويبدأ حين يعمل عامل الجمع.",
} as const;

/** What a translation must fill in for one entry: a sentence for a sentence,
 *  a function of the same arity for a counted sentence, a table with the same
 *  codes for a code table, a list of the same length for a word list. */
type Loosen<V> = V extends string
  ? string
  : V extends (...args: infer A) => string
    ? (...args: A) => string
    : V extends readonly string[]
      ? readonly string[]
      : V extends object
        ? { readonly [P in keyof V]: string }
        : never;

/** The shape a translation must fill: every key, in the loosened form. */
export type Strings = { [K in keyof typeof ar]: Loosen<(typeof ar)[K]> };
