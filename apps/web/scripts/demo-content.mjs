// The demo channel and everything a visitor sees on /dashboard without signing in.
// Authored, not collected: no real commenters, no real channel. Dialects are
// written the way their speakers write online; each comment keeps to one.
export const CHANNEL = {
  id: "demo-channel",
  name: "سالم يجرّب",
  handle: "@salem.yjarrib",
};

export const VIDEOS = [
  {
    id: "video-1",
    kind: "video",
    title: "مراجعة آيفون 17 برو بعد شهر من الاستخدام",
  },
  {
    id: "video-2",
    kind: "short",
    title: "أفضل 5 تطبيقات مجانية لتنظيم وقتك",
  },
  {
    id: "video-3",
    kind: "video",
    title: "تجربة سماعات سوني الجديدة على رحلة طيران طويلة",
  },
  {
    id: "video-4",
    kind: "stream",
    title: "بث مباشر: نجاوب على أسئلتكم عن اللابتوبات قبل الدراسة",
  },
  {
    id: "video-5",
    kind: "video",
    title: "هل يستحق جالكسي S26 الترقية؟ مقارنة صريحة",
  },
  {
    id: "video-6",
    kind: "video",
    title: "احمِ حساباتك من الاختراق في 10 دقائق",
  },
];

// The e2e fixture keeps its two videos; only the titles change.
export const E2E_VIDEOS = [
  {
    id: "video-1",
    kind: "video",
    title: "مراجعة آيفون 17 برو بعد شهر من الاستخدام",
  },
  {
    id: "video-2",
    kind: "short",
    title: "أفضل 5 تطبيقات مجانية لتنظيم وقتك",
  },
  {
    id: "video-3",
    kind: "stream",
    title: "بث مباشر: نجاوب على أسئلتكم عن اللابتوبات قبل الدراسة",
  },
];

// id → display name. Handles and names from across the region; none real.
export const AUTHORS = {
  a01: "نورة الدوسري",
  a02: "@abu_faisal",
  a03: "يوسف بن عمر",
  a04: "مريم الشرقاوي",
  a05: "حسام الدين محمود",
  a06: "@khadija.tn",
  a07: "عبدالله العتيبي",
  a08: "ريم الكواري",
  a09: "أمين بوزيان",
  a10: "سارة خليل",
  a11: "@omar.dz",
  a12: "ليلى حداد",
  a13: "محمد الزهراني",
  a14: "طارق بن سعيد",
  a15: "هدى المرزوقي",
  a16: "@karim_casablanca",
  a17: "أحمد سمير",
  a18: "فاطمة العلي",
  a19: "@3li_iq",
  a20: "دينا مصطفى",
  a21: "خالد الشامسي",
  a22: "منال بن يحيى",
  a23: "@rashid_om",
  a24: "إبراهيم النور",
  a25: "سلمى الإدريسي",
  a26: "@yazan.jo",
  a27: "بدر الحربي",
  a28: "أسماء بوعزيز",
  a29: "وليد الخطيب",
  a30: "@mona.eg",
};

// label: positive | negative | neutral | mixed | null (unanalysed)
// topic: one of the ten keys | null
// date: ISO or null (unknown); likes: number or null (unknown)
// reply: id of the parent comment or null; owner: true for the channel's own reply
// type: comment_type or null; stale: true → prediction hash is of the OLD text
// review: { label, reason, by } → one human sentiment review; treview: { topic, reason, by }
export const COMMENTS = [
  // ---- video-1: iPhone 17 Pro after a month ----
  {
    id: "c01",
    video: "video-1",
    author: "a01",
    date: "2026-08-20T17:12:00Z",
    likes: 142,
    label: "positive",
    topic: "praise",
    text: "ما شاء الله مراجعة وافية، حسّيت إني استخدمت الجهاز شهر معك. كمّل يا سالم",
  }, // Gulf (Saudi)
  {
    id: "c02",
    video: "video-1",
    author: "a02",
    date: "2026-08-20T18:05:00Z",
    likes: 88,
    label: "mixed",
    topic: "criticism",
    text: "الكاميرا صراحة خرافية بس البطارية ما عجبتني، ما تكمّل يوم كامل معي",
  }, // Gulf
  {
    id: "c03",
    video: "video-1",
    author: "a03",
    date: "2026-08-21T09:40:00Z",
    likes: 31,
    label: "neutral",
    topic: "question",
    text: "واش كاين فرق كبير بين 17 برو و16 برو فالكاميرا ولا غير التسويق؟",
  }, // Maghrebi (Moroccan)
  {
    id: "c04",
    video: "video-1",
    author: "a04",
    date: "2026-08-21T11:15:00Z",
    likes: 57,
    label: "negative",
    topic: "criticism",
    text: "السعر ده مبالغ فيه جدًا، مفيش حاجة جديدة تستاهل الفرق كله",
  }, // Egyptian
  {
    id: "c05",
    video: "video-1",
    author: "a05",
    date: "2026-08-21T12:02:00Z",
    likes: 12,
    label: "neutral",
    topic: "request",
    text: "ممكن فيديو مقارنة مع البكسل؟ محتار بينهم",
  }, // Egyptian
  {
    id: "c06",
    video: "video-1",
    author: "a06",
    date: "2026-08-22T20:30:00Z",
    likes: 44,
    label: "positive",
    topic: "personal",
    text: "شريتو الأسبوع اللي فات وصراحة معجبة بيه برشا، خاصة الشاشة فالشمس",
  }, // Maghrebi (Tunisian)
  {
    id: "c07",
    video: "video-1",
    author: "a07",
    date: "2026-08-23T07:55:00Z",
    likes: 9,
    label: "negative",
    topic: "criticism",
    text: "المراجعة طويلة زيادة عن اللزوم، نص الفيديو كلام معاد",
  }, // Gulf
  {
    id: "c08",
    video: "video-1",
    author: "a08",
    date: "2026-08-23T15:20:00Z",
    likes: 26,
    label: "positive",
    topic: "praise",
    text: "أخيرًا أحد يتكلم عن السخونة بصراحة، شكرًا على الأمانة",
  }, // Gulf (Qatari)
  {
    id: "c09",
    video: "video-1",
    author: "a09",
    date: "2026-08-24T10:10:00Z",
    likes: 5,
    label: "neutral",
    topic: "question",
    text: "هل تنصح بيه لواحد جاي من أندرويد ولا نستنى الجيل الجاي؟",
    reply: null,
  }, // Maghrebi (Algerian)
  {
    id: "c10",
    video: "video-1",
    author: "a10",
    date: "2026-08-24T10:41:00Z",
    likes: 18,
    label: "neutral",
    topic: "discussion",
    text: "من تجربتي الانتقال سهل، أهم شي تنقل الصور قبل ما تبيع القديم",
    reply: "c09",
  }, // Levantine
  {
    id: "c11",
    video: "video-1",
    author: "owner",
    date: "2026-08-24T12:00:00Z",
    likes: 63,
    label: null,
    topic: null,
    owner: true,
    text: "شكرًا لكم، فيديو المقارنة مع البكسل الأسبوع الجاي إن شاء الله",
    reply: "c05",
  },
  {
    id: "c12",
    video: "video-1",
    author: "a11",
    date: "2026-08-26T22:18:00Z",
    likes: 3,
    label: "mixed",
    topic: "discussion",
    text: "الجهاز مليح بصح الثمن عندنا فالجزائر يقارب راتب شهرين، صعيبة",
  }, // Maghrebi (Algerian)
  {
    id: "c13",
    video: "video-1",
    author: "a12",
    date: null,
    likes: null,
    label: "positive",
    topic: "humour",
    text: "شفت الفيديو ثلاث مرات وبعدني ما اشتريت… لك شو هالحكي المقنع 😂",
  }, // Levantine (Syrian) — unknown date & likes
  // ---- video-2: five free apps (short) ----
  {
    id: "c14",
    video: "video-2",
    author: "a13",
    date: "2026-08-27T13:30:00Z",
    likes: 71,
    label: "positive",
    topic: "praise",
    text: "التطبيق الثالث غيّر يومي، الله يعطيك العافية",
  }, // Gulf
  {
    id: "c15",
    video: "video-2",
    author: "a14",
    date: "2026-08-27T14:02:00Z",
    likes: 8,
    label: "neutral",
    topic: "question",
    text: "التطبيق الأول موجود على أندرويد ولا بس آيفون؟",
  }, // Gulf (Omani)
  {
    id: "c16",
    video: "video-2",
    author: "a15",
    date: "2026-08-27T14:25:00Z",
    likes: 15,
    label: "positive",
    topic: "discussion",
    text: "موجود على الاثنين، أنا أستخدمه من سنة ومرتاحة",
    reply: "c15",
  }, // Gulf (Emirati)
  {
    id: "c17",
    video: "video-2",
    author: "a16",
    date: "2026-08-28T09:00:00Z",
    likes: 22,
    label: "negative",
    topic: "criticism",
    text: "الشورت سريع بزاف، ما فهمت والو من التطبيق الرابع",
  }, // Maghrebi (Moroccan)
  {
    id: "c18",
    video: "video-2",
    author: "a17",
    date: "2026-08-28T19:45:00Z",
    likes: 4,
    label: "neutral",
    topic: "request",
    text: "لو تعمل نسخة طويلة من الفيديو ده هيبقى أحسن",
  }, // Egyptian
  {
    id: "c19",
    video: "video-2",
    author: "a18",
    date: "2026-08-29T08:10:00Z",
    likes: 11,
    label: "mixed",
    topic: "discussion",
    text: "التطبيقات حلوة بس أغلبها فيه اشتراك مخفي بعد التجربة المجانية",
  }, // Gulf
  {
    id: "c20",
    video: "video-2",
    author: "a19",
    date: "2026-08-30T21:33:00Z",
    likes: 2,
    label: "positive",
    topic: "praise",
    text: "عاشت ايدك، هاي أول مرة أشوف شرح مختصر ومفيد بنفس الوقت",
  }, // Iraqi
  {
    id: "c21",
    video: "video-2",
    author: "a20",
    date: "2026-09-02T11:11:00Z",
    likes: null,
    label: null,
    topic: null,
    text: "حد جرّب التطبيق الخامس على الآيباد؟",
  }, // Egyptian — unanalysed, unknown likes
  // ---- video-3: Sony headphones on a long flight ----
  {
    id: "c22",
    video: "video-3",
    author: "a21",
    date: "2026-09-01T17:40:00Z",
    likes: 39,
    label: "positive",
    topic: "praise",
    text: "أفضل مراجعة سماعات شفتها، خصوصًا جزئية العزل في الطيارة",
  }, // Gulf (Emirati)
  {
    id: "c23",
    video: "video-3",
    author: "a22",
    date: "2026-09-01T18:22:00Z",
    likes: 6,
    label: "neutral",
    topic: "question",
    text: "تقدر تقولنا قداش تدوم البطارية بالضبط مع العزل مشغّل؟",
  }, // Maghrebi (Tunisian)
  {
    id: "c24",
    video: "video-3",
    author: "a23",
    date: "2026-09-02T06:15:00Z",
    likes: 27,
    label: "negative",
    topic: "criticism",
    text: "جربتها بنفسي، الضغط على الأذن بعد ساعتين ما ينطاق. ما أنصح فيها للرحلات الطويلة",
  }, // Gulf (Omani)
  {
    id: "c25",
    video: "video-3",
    author: "a24",
    date: "2026-09-02T13:50:00Z",
    likes: 14,
    label: "mixed",
    topic: "discussion",
    text: "الصوت نضيف والعزل قوي، لكن السعر يا زول ما بشجّع",
  }, // Sudanese
  {
    id: "c26",
    video: "video-3",
    author: "a25",
    date: "2026-09-03T10:05:00Z",
    likes: 19,
    label: "positive",
    topic: "personal",
    text: "استعملتها فرحلة الدار البيضاء–مونتريال ونمت طول الطريق، فعلا تستاهل",
  }, // Maghrebi (Moroccan)
  {
    id: "c27",
    video: "video-3",
    author: "a26",
    date: "2026-09-03T15:30:00Z",
    likes: 7,
    label: "neutral",
    topic: "request",
    text: "بتقدر تعمل مقارنة مع سماعات بوز؟ محتار بيناتهم",
  }, // Levantine (Jordanian)
  {
    id: "c28",
    video: "video-3",
    author: "a27",
    date: "2026-09-04T23:59:00Z",
    likes: 1,
    label: "negative",
    topic: "criticism",
    text: "الصوت في الفيديو نفسه واطي، ارفعوا مستوى المايك المرة الجاية",
  }, // Gulf — stale: analysed on the older text below
  {
    id: "c29",
    video: "video-3",
    author: "a28",
    date: "2026-09-06T12:00:00Z",
    likes: 10,
    label: "positive",
    topic: "praise",
    text: "يعطيك الصحة، شرحك واضح حتى للي ما يفهمش بزاف في التقنية",
  }, // Maghrebi (Algerian)
  // ---- video-4: live Q&A about laptops ----
  {
    id: "c30",
    video: "video-4",
    author: "a29",
    date: "2026-09-05T18:20:00Z",
    likes: 24,
    label: "neutral",
    topic: "question",
    text: "لطالب هندسة بميزانية 4000 ريال، شو بتنصح؟",
  }, // Levantine
  {
    id: "c31",
    video: "video-4",
    author: "a13",
    date: "2026-09-05T18:35:00Z",
    likes: 16,
    label: "positive",
    topic: "discussion",
    text: "بنفس الميزانية أخذت ثينك باد السنة الماضية وما ندمت",
    reply: "c30",
  }, // Gulf
  {
    id: "c32",
    video: "video-4",
    author: "a30",
    date: "2026-09-05T19:02:00Z",
    likes: 33,
    label: "positive",
    topic: "praise",
    text: "البث كان ممتع جدًا، أول مرة أحضر لايف كامل من غير ما أزهق",
  }, // Egyptian
  {
    id: "c33",
    video: "video-4",
    author: "a07",
    date: "2026-09-05T19:48:00Z",
    likes: 12,
    label: "negative",
    topic: "criticism",
    text: "الصوت كان يقطع كل شوي، ياليت تحل مشكلة النت قبل البث الجاي",
  }, // Gulf
  {
    id: "c34",
    video: "video-4",
    author: "a02",
    date: "2026-09-06T08:30:00Z",
    likes: 5,
    label: "mixed",
    topic: "criticism",
    text: "الأسئلة حلوة بس الإجابات كانت عامة، كنت أتوقع أرقام وموديلات محددة",
  }, // Gulf
  {
    id: "c35",
    video: "video-4",
    author: "a10",
    date: "2026-09-07T14:10:00Z",
    likes: 3,
    label: "neutral",
    topic: "request",
    text: "بتعمل بث ثاني عن الشاشات؟ بدي أجهّز مكتب",
  }, // Levantine
  // ---- video-5: Galaxy S26 upgrade? ----
  {
    id: "c36",
    video: "video-5",
    author: "a21",
    date: "2026-09-09T15:25:00Z",
    likes: 52,
    label: "positive",
    topic: "praise",
    text: "مقارنة صريحة فعلًا، ما مدحت ولا ذميت بلا سبب. هذا اللي نبيه",
  }, // Gulf (Emirati)
  {
    id: "c37",
    video: "video-5",
    author: "a16",
    date: "2026-09-09T16:40:00Z",
    likes: 29,
    label: "negative",
    topic: "criticism",
    text: "شخصيا ما شفت حتى سبب باش نبدل، نفس التلفون بثمن أغلى",
  }, // Maghrebi (Moroccan)
  {
    id: "c38",
    video: "video-5",
    author: "a04",
    date: "2026-09-10T07:12:00Z",
    likes: 17,
    label: "mixed",
    topic: "discussion",
    text: "الشاشة أحلى بكتير بس الكاميرا مفيش فرق يذكر، لو معاك S24 استنى",
  }, // Egyptian
  {
    id: "c39",
    video: "video-5",
    author: "a12",
    date: "2026-09-10T20:05:00Z",
    likes: 8,
    label: "neutral",
    topic: "question",
    text: "التحديثات لكم سنة؟ هاد الشي أهم عندي من الكاميرا",
  }, // Levantine (Syrian)
  {
    id: "c40",
    video: "video-5",
    author: "a19",
    date: "2026-09-11T09:30:00Z",
    likes: 21,
    label: "positive",
    topic: "humour",
    text: "أكو ناس تبدل تلفونها كل سنة وأكو أنا، أشوف الفيديو وأكتفي 😅",
  }, // Iraqi
  {
    id: "c41",
    video: "video-5",
    author: "a08",
    date: "2026-09-12T18:45:00Z",
    likes: 4,
    label: null,
    topic: null,
    text: "طيب والنسخة الألترا؟ ما ذكرتها",
  }, // Gulf — unanalysed
  // ---- video-6: protect your accounts ----
  {
    id: "c42",
    video: "video-6",
    author: "a01",
    date: "2026-09-13T14:20:00Z",
    likes: 36,
    label: "positive",
    topic: "praise",
    text: "فعّلت التحقق بخطوتين على كل حساباتي وأنا أشوف الفيديو. شكرًا من القلب",
  }, // Gulf (Saudi)
  {
    id: "c43",
    video: "video-6",
    author: "a22",
    date: "2026-09-13T21:05:00Z",
    likes: 13,
    label: "positive",
    topic: "personal",
    text: "أمي تسرقلها الحساب العام اللي فات، بعثتلها الفيديو توّا. يعطيك الصحة",
  }, // Maghrebi (Tunisian)
  {
    id: "c44",
    video: "video-6",
    author: "a17",
    date: "2026-09-14T10:33:00Z",
    likes: 6,
    label: "neutral",
    topic: "question",
    text: "التطبيق اللي ذكرته للمصادقة آمن؟ ولا فيه بديل من جوجل نفسها؟",
  }, // Egyptian
];

// The text c28 was analysed on, before its author edited it (the stale-hash row).
export const STALE_OLD_TEXT = { c28: "الصوت في الفيديو نفسه واطي" };

// Human reviews on the demo: a reviewer corrected two labels and one topic.
export const REVIEWS = [
  {
    id: "c19",
    label: "negative",
    reason: "الشكوى من الاشتراك المخفي هي الرسالة، والمدح مجاملة",
    by: "reviewer-1",
    at: "2026-09-10T09:00:00Z",
  },
  {
    id: "c25",
    label: "mixed",
    reason: "تأكيد التصنيف بعد المراجعة",
    by: "reviewer-1",
    at: "2026-09-10T09:05:00Z",
  },
];
export const TOPIC_REVIEWS = [
  {
    id: "c13",
    topic: "praise",
    reason: "مزاح لكنه مدح للمحتوى",
    by: "reviewer-1",
    at: "2026-09-10T09:10:00Z",
  },
];

// The e2e kernel: the SAME seven rows as the current fixture, re-skinned. Keep
// every structural field as the generator copies it from the current file;
// only these strings are new.
export const E2E_COMMENTS = {
  "fixture-1": {
    author: "نورة الدوسري",
    text: "المراجعة واضحة ومفيدة، شكرًا",
  },
  "fixture-2": {
    author: "@abu_faisal",
    text: "ياليت تحسّن الصوت، المايك واطي",
  },
  "fixture-3": { author: "يوسف بن عمر", text: "شحال من حلقة باقية فالسلسلة؟" },
  "fixture-4": {
    author: "مريم الشرقاوي",
    text: "الفكرة حلوة بس الشرح طويل شوية",
  },
  "fixture-5": {
    author: "حسام الدين محمود",
    text: "حد جرّب التطبيق ده على أندرويد؟",
  },
  "fixture-6": {
    author: "@khadija.tn",
    text: "برشا معلومات مفيدة، يعطيك الصحة",
  },
  "aaaaaaaa-0000-4000-8000-00000000000f": {
    author: "@salem.yjarrib",
    text: "أهلًا بك، تابع بقية الحلقات على القناة.",
  },
};
// fixture-6 is the "text changed after analysis" row: its prediction keeps the hash of this older text.
export const E2E_STALE_OLD_TEXT = { "fixture-6": "معلومات مفيدة" };

// The ten topics, unchanged from the current fixture — carried byte-identical
// into both generated files.
export const TOPICS = [
  {
    key: "question",
    name_ar: "استفسارات وأسئلة",
    name_en: "Questions & inquiries",
    description:
      "Asks the creator or others something, or requests information.",
    position: 1,
    retired: false,
  },
  {
    key: "religious",
    name_ar: "دعاء وذكر وتعبير ديني",
    name_en: "Prayers & religious remarks",
    description:
      "Prayer, supplication, remembrance of God, religious phrasing as the main content.",
    position: 2,
    retired: false,
  },
  {
    key: "praise",
    name_ar: "إشادة ودعم",
    name_en: "Praise & support",
    description:
      "Compliments, thanks, encouragement toward the creator or content.",
    position: 3,
    retired: false,
  },
  {
    key: "criticism",
    name_ar: "نقد واعتراض",
    name_en: "Criticism & objection",
    description:
      "Disagreement, complaint, or negative judgement of the content, creator or subject.",
    position: 4,
    retired: false,
  },
  {
    key: "request",
    name_ar: "طلبات واقتراحات",
    name_en: "Requests & suggestions",
    description:
      "Asks for future content, features, changes, or makes a suggestion.",
    position: 5,
    retired: false,
  },
  {
    key: "discussion",
    name_ar: "نقاش وتحليل الموضوع",
    name_en: "Discussion of the subject",
    description: "Substantive commentary on the topic of the video itself.",
    position: 6,
    retired: false,
  },
  {
    key: "personal",
    name_ar: "تجارب وقصص شخصية",
    name_en: "Personal stories & experiences",
    description: "Shares the commenter's own situation or experience.",
    position: 7,
    retired: false,
  },
  {
    key: "humour",
    name_ar: "مزاح ودعابة",
    name_en: "Humour & banter",
    description: "Jokes, memes, playful remarks.",
    position: 8,
    retired: false,
  },
  {
    key: "promotion",
    name_ar: "ترويج ومحتوى دعائي",
    name_en: "Promotion & spam",
    description:
      "Advertising, self-promotion, links, repeated off-purpose content.",
    position: 9,
    retired: false,
  },
  {
    key: "other",
    name_ar: "خارج الموضوع / أخرى",
    name_en: "Off-topic / other",
    description: "Does not fit the above or is unrelated to the video.",
    position: 10,
    retired: false,
  },
];
