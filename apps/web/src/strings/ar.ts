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
  // The rail carries state, not signposts: which workspace, and whether
  // collection is running — said in the same words the operations page uses.
  railWorkspaceCaption: "مساحة العمل",
  railWorkspaceNone: "لم تُختر مساحة عمل بعد",
  railCollectionCaption: "الجمع",
  railCollectionReading: "جارٍ قراءة حالة الجمع…",
  railCollectionUnavailable: "تعذّرت قراءة حالة الجمع",
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
  stepCollect: "اختر الفيديوهات التي تُجمع، ثم تابع حالتها في صفحة التشغيل.",
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
  // "عامل الجمع" was the product's word for a process the reader cannot see,
  // start or stop. The reader-facing sentences say what is true of the
  // collection instead — running, or stopped with nothing running — and what
  // they can do. The term survives only in the attempt log's forensic lines,
  // where it names the thing an operator is actually inspecting.
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
    stalled: "توجد مهام منتظرة والجمع متوقّف — لا شيء يعمل لتنفيذها",
    never_run: "لم تُنفذ أي مزامنة بعد",
    never_run_no_worker: "لم تُنفذ أي مزامنة بعد، والجمع متوقّف الآن",
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
  jobQueuedWithWorker: "في الطابور، ولم يبدأ الجمع فيها بعد.",
  jobQueuedNoWorker:
    "في الطابور، والجمع متوقّف الآن — لا شيء يعمل. لن تبدأ حتى يعود.",
  jobRunningHeadline: "قيد التنفيذ",
  jobRunningDetail: "الجمع يعمل على هذه المهمة الآن.",
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
  opsWorkerLabel: "الجمع:",
  opsWorkerConnected: (heartbeat: string) => `يعمل، آخر إشارة ${heartbeat}`,
  opsWorkerDisconnected:
    "متوقّف الآن — لا شيء يعمل. لن تُحدَّث البيانات حتى يعود.",
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
  opsNoAttemptsLead: "اختر فيديوهات من القائمة أعلاه لتبدأ محاولة.",
  opsAttemptN: (n: number) => ` · المحاولة ${n}`,
  opsCancel: "سحب من الطابور",
  refresh: "تحديث",
  opsCancelFailed: "تعذّر سحب المهمة — قد يكون عامل قد بدأها بالفعل.",
  opsRetryFailed: "تعذّرت إعادة المحاولة.",
  opsCancelled: "سُحبت المهمة من الطابور.",
  opsRetried: "أُضيفت محاولة جديدة، تستأنف من حيث توقّفت السابقة.",

  // ---- the catalogue: which videos, what they cost, what was collected ----
  catTitle: "الفيديوهات",
  catLead:
    "اختر ما يُجمع ويُحلَّل. العدد كما يعلنه يوتيوب، وليس وعدًا بما يمكن جلبه.",
  catRefresh: "تحديث القائمة",
  catRefreshed: (when: string) => `القائمة كما كانت في ${when}`,
  catNeverRefreshed: "لم تُبنَ القائمة بعد.",
  catRequested: "طُلب بناء القائمة؛ تظهر النتيجة عند اكتمالها.",
  catRequestFailed: "تعذّر طلب بناء القائمة.",
  catSearch: "ابحث في العناوين",
  catKindAll: "الكل",
  catKindVideo: "فيديو",
  catKindShort: "شورت",
  catKindStream: "بث",
  catSortLabel: "الترتيب",
  catSortNewest: "الأحدث",
  catSortOldest: "الأقدم",
  catSortMost: "الأكثر تعليقًا",
  catSelectView: "اختر المعروض",
  catClear: "إلغاء الاختيار",
  catFit: "اختر الأحدث بما يناسب الحصة",
  catSelected: (videos: number, upTo: number) =>
    `المحدد: ${videos} فيديو · حتى ${upTo} تعليقًا`,
  catUnknownCount: (n: number) => `و${n} بعدد غير معروف`,
  catRemainingAfter: (n: number) => `يتبقى بعدها ${n}`,
  catExceeds: "الاختيار يتجاوز ما تبقى من الحصة؛ ألغِ بعضه أولًا.",
  catNoPlan: "لا خطة مفعّلة، فلا حصة تُقاس عليها.",
  catSave: "احفظ الاختيار",
  catSaving: "يُحفظ…",
  catSaved: "حُفظ الاختيار وطُلب الجمع.",
  catSavedDeferred: "حُفظ الاختيار؛ الجمع في الدورة القادمة.",
  catSaveFailed: "تعذّر حفظ الاختيار.",
  catSaveQuota: "رُفض الاختيار: يتجاوز ما تبقى من الحصة.",
  catCountUnknown: "—",
  catLiveNote:
    "الفيديو المحدد يبقى حيًّا: تُجمع تعليقاته الجديدة دوريًا وتستهلك من الحصة عند وصولها.",
  catStateUnselected: "غير محدد",
  catStateWaiting: "بانتظار الجمع",
  catStateCollecting: "يُجمع الآن",
  catStateCollected: (n: number, when: string) => `جُمع ${n} في ${when}`,
  catStateDisabled: "تعليقات معطّلة",
  catStatePartial: "جزئي",
  catEmpty: "لا فيديوهات في القائمة بعد.",
  catNoMatch: "لا نتائج لهذا البحث.",
  catReadFailed: "تعذّرت قراءة القائمة.",
  chooseVideos: "اختر الفيديوهات",

  // ---- the dashboard, part one: head, index, filters, summary ----
  figuresShow: "عرض الأرقام",
  figuresComments: "تعليقات",
  secSummary: "الملخص",
  secVideos: "الفيديوهات",
  secVoice: "صوت الجمهور",
  secTiming: "التوقيت",
  secPeople: "المعلّقون",
  secCompare: "المقارنة",
  secEngaged: "الأكثر تفاعلًا",
  secComments: "التعليقات",
  dateOrderError: "يجب أن يسبق تاريخ البداية تاريخ النهاية",
  chipSearch: (q: string) => `بحث: «${q}»`,
  chipVideo: "فيديو محدَّد",
  chipSentiment: (label: string) => `المشاعر: ${label}`,
  chipVideoKind: "نوع فيديو",
  chipCommentType: "نوع تعليق",
  chipRepliesOnly: "الردود فقط",
  chipCommentsOnly: "التعليقات فقط",
  chipReviewedOnly: "المراجَعة فقط",
  chipUnreviewedOnly: "غير المراجَعة فقط",
  chipDatedOnly: "بتاريخ معروف",
  chipUndatedOnly: "بلا تاريخ معروف",
  chipPeriod: "فترة محدَّدة",
  noKnownDates: "لا توجد تواريخ معروفة",
  dashEyebrow: "نظرة عامة",
  dashDemoTag: "معاينة تجريبية",
  dashTitle: "ماذا يقول جمهورك — وأين يقوله؟",
  dashRead: (comments: string, videos: number) =>
    `قراءة ${comments} تعليقًا عبر ${videos} فيديو، مع من قالها ومتى.`,
  pillComments: (n: string) => `${n} تعليقًا`,
  pillAuthors: (n: string) => `${n} معلّقًا معروفًا`,
  splitOf: (n: string) => `من ${n} تعليقًا مصنَّفًا:`,
  readingStored: "جارٍ قراءة التعليقات المحفوظة…",
  reportSectionsLabel: "أقسام التقرير",
  filteredLabel: "مُصفّى:",
  showAll: "اعرض الكل",
  hideFilters: "إخفاء الفلاتر",
  showFilters: "إظهار الفلاتر",
  filtersLabel: "فلاتر التقرير",
  searchLabel: "البحث في التعليقات والمؤلفين",
  videoLabelText: "الفيديو",
  allVideos: "كل الفيديوهات",
  sentimentLabel: "المشاعر",
  allSentiments: "كل المشاعر",
  videoKindLabel: "نوع الفيديو",
  allKinds: "كل الأنواع",
  kindVideo: "فيديو",
  kindShort: "شورت",
  kindStream: "بث",
  participationLabel: "نوع المشاركة",
  commentsAndReplies: "تعليقات وردود",
  originalOnly: "تعليقات أصلية فقط",
  repliesOnly: "ردود فقط",
  commentTypeLabel: "نوع التعليق",
  reviewStatusLabel: "حالة المراجعة",
  all: "الكل",
  reviewedByHuman: "مراجَعة بشريًا",
  unreviewed: "دون مراجعة",
  dateLabel: "التاريخ",
  allDates: "كل التواريخ",
  knownDates: "التواريخ المعروفة",
  unknownDates: "بلا تاريخ معروف",
  fromDate: "من تاريخ",
  toDate: "إلى تاريخ (غير شامل)",
  perPageLabel: "عدد التعليقات في الصفحة",
  applyFilters: "تطبيق الفلاتر",
  resetFilters: "إعادة ضبط الفلاتر",
  periodNote:
    "الفترة حسب تاريخ نشر التعليق بتوقيت إسطنبول. التواريخ غير المعروفة تظهر عند عرض كل الفترات.",
  loadingComments: "جارٍ تحميل التعليقات…",
  updatingResults: "جارٍ تحديث النتائج…",
  filtersFailed: "وصلت بياناتك، لكن تعذّر تطبيق الفلاتر عليها.",
  loadFailed: "تعذر تحميل البيانات. حاول مرة أخرى.",
  failureCode: "رمز العطل:",
  summaryLead: "الأرقام أدناه تتبع الفلاتر المطبَّقة أعلاه.",
  ownerExcluded: (n: string) =>
    `وتستبعد ${n} ردًّا من القناة نفسها: ردُّ القناة على متابعيها ليس رأي جمهورها، ولا يدخل في أي مقام هنا. لذلك يقل الإجمالي عمّا يظهر على يوتيوب بهذا العدد.`,
  metricsLabel: "المؤشرات",
  metricComments: "التعليقات والردود",
  metricCommentsNote: "كل ما تطابق مع الفلاتر.",
  metricAnalysed: "المحلَّلة",
  metricAnalysedNote: "تحمل تصنيفًا صالحًا للتحليل الحالي.",
  metricUnanalysed: "غير المحلَّلة أو القديمة",
  metricUnanalysedNote: "محفوظة، ولا تدخل في نسب المشاعر.",
  metricReplies: "الردود",
  metricRepliesNote: "ردود على تعليقات، لا تعليقات أصلية.",
  metricAuthors: "معلّقون معروفون",
  metricAuthorsNote: "محسوبون بمعرّف القناة، لا بالاسم المعروض.",
  insightAnalysis: "التحليل",
  insightAnalysed: (pct: number) =>
    `حُلِّل ${pct}٪ من التعليقات المطابقة. الباقي محفوظ بلا تصنيف، ولا يدخل في أي نسبة مشاعر.`,
  insightNoMatches: "لا توجد تعليقات مطابقة، فلا نسبة تحليل يمكن ذكرها.",
  insightReplies: "الردود",
  insightRepliesShare: (pct: number) =>
    `${pct}٪ منها ردود — أي حوار بين المشاهدين أنفسهم لا خطاب موجَّه إلى القناة.`,
  insightRepliesNone: "لا بيانات كافية لقياس نسبة الردود.",
  insightConcentration: "تركّز الحديث",
  insightTopVideo: (top: string, total: string, pct: number) =>
    `أنشط فيديو جمع ${top} تعليقًا من أصل ${total} — أي ${pct}٪ من الحديث كله.`,
  insightNoVideo: "لا فيديو ضمن الفلاتر الحالية.",
  insightDates: "التواريخ",
  insightUndated: (n: string) =>
    `${n} تعليقًا بلا تاريخ معروف. لا تظهر في رسوم التوقيت، ولم تُوضع في خانة افتراضية.`,
  insightAllDated: "كل التعليقات المطابقة تحمل تاريخًا معروفًا.",

  // ---- the dashboard, part two: panels ----
  emptyNoCommentsTitle: "لم تصل تعليقات بعد",
  emptyNoCommentsLead:
    "لا توجد تعليقات محفوظة لمساحة العمل هذه. لا علاقة للفلاتر بذلك — لم يكتمل جمعٌ بعد.",
  emptyFollowCollection: "اختر الفيديوهات وتابع حالة الجمع",
  emptyConnectOrSync: "اربط قناة",
  emptyNoMatchTitle: "لا توجد تعليقات مطابقة لهذه الفلاتر",
  emptyNoMatchLead: (total: string) =>
    `${total} تعليقًا محفوظًا في مساحة العمل، ولا واحد منها يطابق ما اخترته. وسّع الفلاتر أو أعد ضبطها.`,
  showAllComments: "اعرض كل التعليقات",
  videosLead:
    "اضغط أي فيديو لتصفية اللوحة كاملة عليه. الأرقام مشتقة من التعليقات المحفوظة، لا من مؤشرات يوتيوب للفيديو.",
  countComments: (n: string) => `${n} تعليقًا`,
  countReplies: (n: string) => `${n} ردًّا`,
  countAnalysed: (n: string) => `${n} محلَّلًا`,
  unitComments: "تعليقًا",
  voiceLead: (analysed: string) =>
    `المقام: ${analysed} تعليقًا ذا تصنيف صالح — لا العدد الكلي. المشاعر المختلطة فئة مستقلة، لا وسط بين طرفين.`,
  sentimentsTitle: "المشاعر",
  legendMeasured: (label: string, count: string, pct: number) =>
    `${label}: ${count} (${pct}٪)`,
  legendUnmeasured: (label: string) => `${label}: لا يقيسه النموذج الحالي`,
  noLabelsStrong: "لا يوجد تصنيف بعد",
  noLabelsLead:
    "التعليقات محفوظة ولم يُشغَّل عليها نموذج تصنيف، فلا توجد نسبة مشاعر تُعرض. هذا غياب تحليل، لا حياد جمهور.",
  topicsTitle: "الموضوعات",
  topicsUnavailableStrong: "غير متاح بعد",
  topicsUnavailableLead:
    "تصنيف التعليقات إلى موضوعات يحتاج طبقة نموذج لغوي لم تُبنَ بعد. لن يُعرض هنا رسم مشتق من كلمات مفتاحية ويُقدَّم كأنه تحليل موضوعي.",
  figureNegative: "تعليقًا سلبيًا — وهي التي تستحق قراءة نصّها لا نسبتها.",
  figurePositive: "تعليقًا إيجابيًا ضمن المحلَّل.",
  figureUnanalysed: "بلا تصنيف بعد، ولا تدخل في أي نسبة أعلاه.",
  timingTitle: "توقيت التفاعل",
  timingLead:
    "متى يصل التعليق. تعليق بتوقيت تقريبي («منذ ٣ أشهر») لا يمكن وضعه في ساعة، فيُستبعد ويُذكر عدده بدل أن يُسنَد إلى منتصف الليل.",
  weeklyTitle: "التعليقات أسبوعيًا",
  weeklyTooFewStrong: "لا يكفي لرسم اتجاه",
  weeklyTooFewLead:
    "التعليقات المطابقة تقع في أقل من ثلاثة أسابيع. رسم خط عبرها كان سيبدو قياسًا لاتجاه، ولا يوجد اتجاه بعد.",
  weeklyCaption: "التعليقات المطابقة، حسب الأسبوع",
  weeklyUnit: "الأسبوع",
  weeklyUnplaceable: (n: string) =>
    `${n} تعليقًا بلا تاريخ صالح لم يدخل هذا الرسم.`,
  weeklyAllPlaced: "كل التعليقات المطابقة دخلت هذا الرسم.",
  hourlyTitle: "حسب ساعة اليوم",
  distributionTooFewStrong: "لا يكفي لرسم توزيع",
  hourlyTooFewLead:
    "ساعة واحدة أو أقل تحمل تعليقًا. أعمدة فارغة عبر اليوم كانت ستقول إننا قِسنا فوجدنا سكونًا.",
  hourlyCaption: "التعليقات المطابقة، حسب ساعة اليوم",
  hourlyUnit: "الساعة",
  hourlyUnplaceable: (n: string) =>
    `${n} تعليقًا بتوقيت أخشن من الساعة، مستبعَد من هذا الرسم.`,
  hourlyAllPlaced: "كل التعليقات المطابقة قابلة للوضع في ساعة.",
  weekdayTitle: "حسب يوم الأسبوع",
  weekdayTooFewLead: "يوم واحد أو أقل يحمل تعليقًا ضمن الفلاتر الحالية.",
  weekdayCaption: "التعليقات المطابقة، حسب يوم الأسبوع",
  weekdayUnit: "اليوم",
  weekdayNote: "اليوم بتوقيت متصفحك.",
  undatedLabel: "تعليقات بلا تاريخ:",
  peopleLead:
    "من يتحدّث، ومن يجد صدى. الهوية بمعرّف القناة لا بالاسم المعروض: شخصان قد يتشابه اسمهما، ودمجهما يخترع معلّقًا لا وجود له.",
  mostActive: "الأكثر نشاطًا",
  mostInfluential: "الأكثر تأثيرًا",
  noCommenterStrong: "لا يوجد معلّق يمكن عدّه",
  noCommenterLead:
    "لا تحمل الصفوف المطابقة اسم كاتب — إمّا لعدم وجود تعليقات، أو لأن الأسماء حُذفت تحت قاعدة الاحتفاظ.",
  likesUnknown: "إعجابات غير معروفة",
  countLikes: (n: string) => `${n} إعجابًا`,
  anonymousNote: (n: string) =>
    `${n} تعليقًا كاتبها محذوف تحت قاعدة الاحتفاظ. لم يُدمج في معلّق واحد، ولا يظهر في الترتيب.`,
  compareTitle: "مقارنة الفيديوهات",
  compareScope:
    "أرقام مشتقة من التعليقات ضمن الفلاتر الحالية فقط. ليست مؤشرات الفيديو الكلية: لتلك نطاق وتاريخ رصد مستقلان.",
  compareTruncated:
    "تُقارَن الفيديوهات الأكثر تعليقًا فقط؛ بقية الفيديوهات ضمن الفلاتر غير معروضة هنا.",
  compareCaption: "مقارنة الفيديوهات ضمن الفلاتر",
  colVideo: "الفيديو",
  colComments: "التعليقات",
  colReplies: "الردود",
  colAnalysed: "المحللة",
  colDistribution: "التوزيع",
  noAnalysedInFilters: "لا توجد تعليقات محللة ضمن الفلاتر",
  shareItem: (label: string, count: number, pct: number) =>
    `${label} ${count} (${pct}٪)`,

  // ---- the dashboard, part three: engaged, comments, review, pager ----
  engagedTitle: "أكثر التعليقات السلبية تفاعلًا",
  engagedLead:
    "ترتيب حسب الإعجابات ضمن الفلاتر الحالية. الإعجابات لا تُرجِّح التصنيف، وقلب صاحب القناة ليس مشاعر إيجابية.",
  engagedEmpty: "لا توجد تعليقات سلبية بإعجابات معروفة ضمن الفلاتر.",
  unitLikes: "إعجابًا",
  humanReview: "مراجعة بشرية",
  engagedTruncated: (shown: number, ranked: number) =>
    `تُعرض ${shown} من ${ranked} تعليقًا سلبيًا لها عدد إعجابات معروف.`,
  engagedUnranked: (n: number) =>
    `${n} تعليقًا سلبيًا بلا عدد إعجابات معروف، فلم تدخل الترتيب. عدد غير معروف ليس صفرًا.`,
  commentsLead:
    "اضغط أي بطاقة لقراءة التعليق كاملًا، والجدول تحتها هو مكان التصحيح والتصدير والتنقّل بين الصفحات.",
  tabMostLiked: "الأكثر إعجابًا",
  tabNewest: "الأحدث",
  tabCritical: "النقدية",
  noLabel: "بلا تصنيف",
  cursorReset: "تغيّرت النتائج فأُعيد العرض من الصفحة الأولى.",
  exportCsv: "تصدير CSV",
  exportNote: (total: number) =>
    `يصدّر كل التعليقات المطابقة للفلاتر الحالية (${total}) وليس الصفحة المعروضة فقط. تُعطَّل صيغ الجداول في الملف دون تغيير النص المخزن.`,
  exportFailed: "تعذر إنشاء ملف التصدير. حاول مرة أخرى.",
  commentsCaption: "التعليقات ضمن الفلاتر",
  colAuthor: "المؤلف",
  colComment: "التعليق",
  colSentiment: "المشاعر",
  colDate: "التاريخ",
  colCorrection: "التصحيح",
  replyTag: "رد",
  unanalysedOrOld: "غير محلل / قديم",
  correctLabelFor: (author: string) => `تصحيح تصنيف تعليق ${author}`,
  correct: "تصحيح",
  reviewFormLabel: "تصحيح التصنيف",
  reviewTitle: "تصحيح تصنيف تعليق",
  reviewCurrent: (label: string) =>
    `التصنيف الحالي: ${label}. التصحيح البشري يلغي تنبؤ النموذج لهذا النص، ويسقط تلقائيًا إذا تغيّر نص التعليق لاحقًا.`,
  unanalysed: "غير محلل",
  reviewHistoryTitle: "سجل المراجعات",
  reviewHistoryEmpty: "لا توجد مراجعات سابقة لهذا التعليق.",
  reviewerUnknown: "مراجع غير معروف",
  correctLabel: "التصنيف الصحيح",
  correctionReason: "سبب التصحيح",
  reviewStale:
    "تغيّر نص التعليق بعد فتح هذه الشاشة. أعد قراءته ثم صحّح التصنيف.",
  reviewSaveFailed: "تعذر حفظ التصحيح. حاول مرة أخرى.",
  saveCorrection: "حفظ التصحيح",
  cancel: "إلغاء",
  reviewFixtureScope:
    "وضع البيانات الاصطناعية: يُحفظ التصحيح في هذه الجلسة فقط ولا يُرسل إلى أي خادم.",
  pagerLabel: "تصفح التعليقات",
  previousPage: "الصفحة السابقة",
  nextPage: "الصفحة التالية",
  pageState: (page: number, shown: number, total: number) =>
    `الصفحة ${page} — عرض ${shown} من ${total} تعليقًا ضمن الفلاتر`,

  // ---- the landing page (Landing.tsx) ----
  lpTitle: "مشاعر الجمهور — افهم ما وراء تعليقات يوتيوب",
  lpMenuLabel: "القائمة الرئيسية",
  lpNavLabel: "تنقل صفحة الهبوط",
  lpNavWhy: "لماذا مشاعر الجمهور؟",
  lpNavExperience: "شاهد التجربة",
  lpNavFaq: "أسئلة شائعة",
  lpOpenAccount: "فتح الحساب",
  lpHeroEyebrow: "تعليقات يوتيوب. رؤية أوضح.",
  lpHeroLine1: "وراء كل تعليق،",
  lpHeroLine2: "صوت يستحق",
  lpHeroLine3: "أن تفهمه.",
  lpHeroLead:
    "لا تكتفِ بعدّ التعليقات. افهم مشاعر جمهورك، قارن فيديوهاتك، وارجع إلى الكلمات التي تصنع الفرق.",
  lpExploreDashboard: "استكشف اللوحة",
  lpSeeHow: "شاهد كيف تعمل",
  lpHeroCaption:
    "المثال المعروض هنا توضيحي؛ بيانات قناتك تتطلب تسجيل الدخول والربط.",
  lpHeroArtLabel: "تصوّر بصري لتحويل التعليقات إلى رؤية واضحة",
  lpFloatTopStrong: "أبعد من الإعجابات",
  lpFloatTop: "افهم ما يقوله جمهورك فعلًا",
  lpFloatBottomStrong: "«جميل، لكن…»",
  lpFloatBottom: "مشاعر مختلطة، وليست محايدة",
  lpHeroWord: "صوت جمهورك",
  lpValue1: "مصمّمة لفهم التعليقات العربية",
  lpValue2: "4 فئات للمشاعر",
  lpValue3: "من النظرة العامة إلى التعليق",
  lpValue4: "القرار الأخير لك",
  lpWhyEyebrow: "من ضجيج التعليقات إلى وضوح الصورة",
  lpWhyLine1: "المشاهدات تقول كم شخصًا وصل إليه محتواك.",
  lpWhyLine2: "التعليقات تقرّبك مما شعروا به.",
  lpWhyLead:
    "اجمع قراءتك للمشاعر والمقارنات والتعليقات في مكان واحد، واحتفظ بالسياق خلف كل رقم.",
  lpZoomIn: "قرّب الصورة",
  lpExperienceEyebrow: "جرّب الفكرة",
  lpExperienceLine1: "صورة كاملة.",
  lpExperienceLine2: "وتفاصيل تستحق التوقف.",
  lpExperienceLead:
    "اختر شعورًا لتقرأ مثالًا. هكذا تنتقل من ملخص الجمهور إلى التعليق نفسه.",
  lpDemoBrand: "نظرة على الجمهور",
  lpDemoLabel: "مثال توضيحي · 4 تعليقات مؤلّفة",
  lpDemoChartLabel: "المشاعر ضمن الاختيار",
  lpDemoInSelection: "تعليقات ضمن الاختيار",
  lpDemoFilterLabel: "تصفية المثال حسب المشاعر",
  lpDemoLink: "اكتشف الفلاتر والتصحيح والتصدير في اللوحة",
  lpBenefit1Tag: "01 / افهم",
  lpBenefit1Title: "المشاعر ليست لونين فقط.",
  lpBenefit1:
    "إيجابي، سلبي، محايد، ومختلط. والتعليق غير المحلّل يظل واضحًا خارج نسب المشاعر.",
  lpBenefit2Tag: "02 / قارن",
  lpBenefit2Title: "ضع كل فيديو في سياقه.",
  lpBenefit2:
    "غيّر الفيديو أو الفترة لترى النتائج ضمن نفس الفلاتر، ثم افحص التعليقات التي تقف خلفها.",
  lpBenefit3Tag: "03 / راجع",
  lpBenefit3Title: "خبرتك جزء من الصورة.",
  lpBenefit3:
    "راجع التصنيف وصحّحه مع ذكر السبب. قراءة الآلة بداية، والمراجعة البشرية تمنحها سياقًا.",
  lpAudienceEyebrow: "مساحة لعملك، مهما كان دورك",
  lpAudienceLine1: "قريب من جمهورك.",
  lpAudienceLine2: "مناسب لطريقة عملك.",
  lpAudienceTabsLabel: "اختر طبيعة عملك",
  lpCreators: "صنّاع المحتوى",
  lpAgencies: "الوكالات والفرق",
  lpForYou: "لك ولجمهورك",
  lpForTeam: "لفريقك وعملائك",
  lpCreatorTitle: "فيديوك التالي يبدأ بالإنصات.",
  lpCreatorText:
    "ارجع إلى التعليقات التي تستحق انتباهك. قارن استقبال فيديوهاتك، وافهم أين يتفق جمهورك وأين تختلف آراؤه.",
  lpCreatorTags: ["قارن الفيديوهات", "راجع ردود الفعل", "خطّط للمحتوى"],
  lpAgencyTitle: "لكل عميل جمهوره. ولكل جمهور صوته.",
  lpAgencyText:
    "قراءة واضحة لكل جمهور، وتقارير تحتفظ بالفلاتر التي بنيت عليها نتائجك. جرّب المراجعة والتصدير الآن؛ تجربة التنقّل بين العملاء ضمن تطوير النسخة الأولية.",
  lpAgencyTags: ["مساحات عمل مستقلة", "تقارير قابلة للتصدير", "مراجعة بشرية"],
  lpExploreWork: "استكشف تجربة العمل",
  lpYourChannelSpace: "مساحة قناتك",
  lpClientSpace: "مساحة العميل",
  lpVideoRow: "فهمٌ أعمق للمحتوى",
  lpWindowNote: "تصفية واحدة، صورة متّسقة",
  lpArtCaption: "تصوّر للواجهة · بيانات توضيحية",
  lpTrustEyebrow: "وضوح يمكنك البناء عليه",
  lpTrustLine1: "الثقة تبدأ",
  lpTrustLine2: "بمعرفة",
  lpTrustLine3: "حدود البيانات.",
  lpTrustLead:
    "ليس كل تعليق متاحًا، وليس كل تصنيف يقينًا. لذلك نُظهر ما تم تحليله وما يحتاج مراجعة.",
  lpTrust1Title: "سياق خلف كل نسبة",
  lpTrust1:
    "تعرّف على التعليقات المحلّلة، والتواريخ غير المعروفة، ونطاق الفلاتر قبل تفسير النتائج.",
  lpTrust2Title: "حالة الجمع ظاهرة",
  lpTrust2: "التغطية الجزئية أو تعذّر الجمع لا تعني أن جمهورك لم يعلّق.",
  lpTrust3Title: "تقرير يعكس ما تراه",
  lpTrust3:
    "صدّر التعليقات وفق الفلاتر نفسها، مع الاحتفاظ بمصدر التصنيف وسجل المراجعة المتاح.",
  lpFaqEyebrow: "قبل أن تبدأ",
  lpFaqTitle: "أسئلة في محلّها.",
  lpFaqLead: "هذه نسخة تجريبية. إليك ما تستطيع تجربته الآن.",
  lpFaq: [
    "هل البيانات في التجربة من قناة حقيقية؟",
    "المثال التفاعلي في هذه الصفحة يستخدم تعليقات اصطناعية معلّمة بوضوح. حُفظت تعليقات قناة اختبار حقيقية في الخدمة، ويجري توصيلها باللوحة الحية لصاحب مساحة العمل.",
    "هل يمكنني ربط قناتي الآن؟",
    "ربط يوتيوب متاح ضمن التجربة الخاصة للحسابات المخوّلة، وقد جُمعت تعليقات حقيقية لقناة اختبار. تتطلب المزامنة تشغيل العامل، وما زال تحليل المشاعر بالنموذج الحي والتحقق من اللوحة الحية قيد الإكمال.",
    "هل تحليل المشاعر دقيق دائمًا؟",
    "لا. السخرية واللهجات والسياق قد تجعل التصنيف ملتبسًا. لذلك تتضمن التجربة فئة للمشاعر المختلطة وتصحيحًا بشريًا؛ لم نعتمد بعد نتيجة دقة لنموذج حي.",
    "هل تُحفظ تصحيحاتي في التجربة؟",
    "التصحيحات على البيانات الاصطناعية تبقى في جلسة المتصفح فقط، ولا تُرسل إلى خادم. يوضّح مصدر البيانات داخل اللوحة متى تكون المراجعات محفوظة.",
  ],
  lpFinalLine1: "جمهورك يتحدث.",
  lpFinalLine2: "ابدأ بالإنصات.",
  lpFinalLead: "خذ جولة في تجربة عربية تجعل التعليقات أقرب إلى الفهم.",
  lpFinalCaption: "المثال هنا توضيحي · ربط القناة للحسابات المخوّلة",
  lpFooterTagline: "رؤية أوضح لما وراء تعليقات يوتيوب.",
  lpFooterNavLabel: "روابط التذييل",
  lpFooterDashboard: "اللوحة",
  lpFooterAccount: "الحساب",
  lpFooterVersion: "مشاعر الجمهور · نسخة أولية",
  lpFooterPreview: "معاينة خاصة — ليست إطلاقًا عامًا",
  /** Direction-dependent glyphs: "onward" points the way the text runs. */
  arrowForward: "←",
  arrowUpForward: "↖",
  arrowDownForward: "↙",
  listSeparator: "، ",
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
