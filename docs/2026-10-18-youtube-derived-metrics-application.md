# التقديم على Derived Metrics في YouTube API

2026-10-18. هذا دليل التقديم خطوة بخطوة، مع إجابات بالإنجليزية جاهزة للصق. **التقديم بيد مالك مشروع Google**.

## لماذا الآن

سياسة YouTube الأساسية تمنع، دون موافقة، ما تقوم عليه ميزة المنافسين: استنتاج نوع الفيديو أو القناة، وحساب درجات مخصّصة للقنوات، وترتيب القنوات ومقارنتها. والمصدر صفحة [Complying with YouTube's Developer Policies](https://developers.google.com/youtube/terms/developer-policies-guide) كما قرأتها في 2026-10-18.

ملحق **Derived Metrics** يسمح بها كلها إن قُبلت حالة استخدامنا:
- التصنيف (§3) والمشاعر (§4) والدرجات والمقارنة (§1 و§5)؛
- وحفظ الإحصاءات العامة والمقاييس المشتقة حتى **36 شهرًا**، بدل دورة الثلاثين يومًا.

المصدر: [Additional policies for derived metrics and data storage](https://developers.google.com/youtube/terms/derived-metrics-policy)، آخر تحديث للصفحة 2026-09-14.

**حتى القبول:**
- تصنيف الأنواع (WO-22، #164) يُبنى ويُدمج **مطفأً**؛
- الإحصاءات اليومية تبقى على حذف بعد 30 يومًا (WO-20).

الموافقة **ليست نموذجًا مستقلًا**. هي قسم داخل القسم 5 من نموذج التدقيق نفسه الذي قدّمته في 2026-09-16. تحقّق من نص النموذج وقت التقديم، فهو يتغيّر.

## 0. قبل أن تفتح النموذج

1. **ابحث في بريدك** (حساب مالك المشروع) عن ردّ من «YouTube API Services» على طلب 2026-09-16.
   - إن سألوا أسئلة، فأجب عليها في الرسالة نفسها، واذكر فيها أنك تقدّم الآن نموذجًا جديدًا يضيف قسم Derived Metrics.
   - لست متأكدًا كيف يتعاملون مع طلبين متزامنين، فالردّ في الرسالة القديمة يمنع الالتباس.
2. **منطقة قاعدة البيانات:** طلب 2026-09-16 قال إن البيانات «في الاتحاد الأوروبي».
   - لكن خطأ الاتصال الذي ألصقته يُظهر `aws-0-ap-south-1.pooler.supabase.com`، وap-south-1 هي منطقة مومباي.
   - تحقّق في Supabase: **Project Settings → General**، ثم حقل Region. اكتب في الإجابات أدناه المنطقة الصحيحة.
3. **الصفحات العامة:** يجب أن تفتح دون كلمة مرور:
   - `https://app.sky-develop.net/`
   - `/privacy-policy`
   - `/terms`
4. **حساب للمراجِع** (يطلبه القسم 4 إن لم يكن التطبيق عامًا بالكامل):
   - أنشئ حسابًا مخصّصًا للمراجعة، فيه قناة وتعليقات محللة.
   - **لا تكتب كلمة مروره في المستودع ولا في المحادثة**. تُكتب في النموذج فقط.
5. **رقم مشروع Google Cloud:** من [console.cloud.google.com](https://console.cloud.google.com)، بطاقة Welcome، حقل **Project number** (أرقام فقط).
6. **حجم الاستعمال الفعلي:** من **APIs & Services → YouTube Data API v3 → Metrics**: عدد الطلبات اليومي في آخر 30 يومًا. ستحتاجه في القسم 5، فاكتب الرقم الحقيقي لا تقديرًا.
7. **لقطات الشاشة:**
   - بدقة 1280×720 على الأقل، وفيها شريط العنوان.
   - ملف واحد لكل خانة، وأصغر من 10MB.
   - أسماء واضحة، مثل `privacy-policy-page.png`.

| الخانة | ماذا تصوّر |
| --- | --- |
| Privacy Policy Screenshots | قسم «Google and YouTube data» وقسم «Retention and deletion» في `/privacy-policy` (ملف PDF واحد بعدة صفحات أسهل) |
| Homepage Screenshot | الصفحة الرئيسية، ورابط سياسة الخصوصية ظاهر |
| Terms of Service Documentation | `/terms`، قسم «Your YouTube channel» |
| OAuth Flow Screenshots | شاشة موافقة Google، والصلاحية المطلوبة، وصفحة `myaccount.google.com/connections` التي يُلغى منها الإذن |
| Dashboard / Feature Screenshots | لوحة المشاعر، والموضوعات، وصفحة مقارنة الفيديوهات |
| Architecture / User Flow (اختياري) | المخطّطان اللذان أرفقتهما في 2026-09-16 |

## 1. النموذج خطوة بخطوة

الرابط: <https://support.google.com/youtube/contact/yt_api_form>

**القسم 1، Request Type:** اختر **Complete a compliance audit to request for additional quota**، فنحن ما زلنا نطلب 50,000 وحدة يوميًا.

**القسم 2، Organization:**
- Legal Name: `self`، كما في المرة السابقة، أو اسم الشركة المسجّل إن كانت Sky Develop مسجّلة رسميًا.
- Primary Website: `https://sky-develop.net`
- العنوان: عنوانك.
- Category: **Analytics and Business Intelligence**.
- Size: الخيار المناسب لحجمك الفعلي.

**القسم 3، Business Model:** الصق الفقرة A أدناه. المستخدمون: **Creators**، و**Businesses / Agencies**، و**Media companies** إن كانت خيارًا. الإيراد: اشتراكات مدفوعة.

**القسم 4، API Client:**
- Name: `Audience Sentiment`؛ لا تحتوي كلمة YouTube.
- URL: `https://app.sky-develop.net`
- Publicly accessible: نعم (تسجيل مفتوح بحساب Google).
- وأعطِ بيانات حساب المراجِع من الخطوة 0.4.

**القسم 5، Use Cases (لكل مشروع):**
1. عدد المشاريع: **1**. ثم رقم المشروع من 0.5.
2. Use Case Category: ضع علامة على **Analytics & Reporting**، و**Tools for Creators**.
3. OAuth 2.0: **Yes**.
4. **قسم Derived Metrics، وهو الأهم:** ضع علامة على **I have read and agree to abide by the additional policies for derived metrics and data storage…**. وإن ظهر مربّع لوصف المقاييس، فالصق الفقرة B.
5. Expected API Usage Volume: الفئة التي يقع فيها رقمك الحقيقي من الخطوة 0.6.
6. Quota Details، اختر النقاط التالية:
   - `youtube.channels.list`
   - `youtube.playlistItems.list`
   - `youtube.videos.list`
   - `youtube.commentThreads.list`
   - `youtube.comments.list`
   - `youtube.search.list`
   - `youtube.channelSections.list`
7. **عن `search.list`:**
   - لم يكن في طلب 2026-09-16، لكن البحث عن قناة بالاسم يستدعيه فعلًا (`supabase/functions/channel-lookup`).
   - حصته تُطلب منفصلة: اكتب **2,000 وحدة يوميًا** (20 بحثًا × 100).
8. Total Per Day Quota: **50,000**.
9. الإثباتات: ارفع لقطات الجدول أعلاه.

**القسم 6:** المخطّطان وملف الأدلة الداعمة، كما في 2026-09-16.

**القسم 7:** كل الإقرارات إلزامية. اقرأها ثم ضع العلامات.

**بعد الإرسال:**
- احفظ رقم الطلب إن ظهر، ولقطة لصفحة التأكيد.
- أرسل لي التاريخ والرقم، فأسجّلهما في `docs/decisions.md`.

## 2. الإجابات الجاهزة (بالإنجليزية)

### A. Describe your organization's work as it relates to YouTube

> Sky Develop builds Audience Sentiment, an Arabic-first audience-analytics service for YouTube creators, agencies and media companies. A channel owner connects their channel with OAuth (read-only use of youtube.force-ssl), or adds public channels they want to follow. We read public video metadata and public comments, classify each comment's sentiment with a self-hosted Arabic language model and its topic with our own taxonomy, and show the owner trends, comparisons between their videos, and the comments behind every number. Nothing is ever written to YouTube. Results are visible only to members of the customer's own workspace.

### B. Derived metrics we create and the data we want to store (Section 5)

> We request the Analytics & Reporting amendment for these derived metrics. Every one is labelled in the product as generated by Audience Sentiment, never as YouTube data:
>
> 1. Viewer sentiment (policy §4): a sentiment label per public comment from our self-hosted Arabic model, aggregated per video and per channel (share positive/negative/neutral over time). Owners may correct labels. We never infer age, gender, religion, political leaning, health or any other protected attribute of a commenter or creator.
> 2. Content categorization (policy §3): topic labels on comments from our own taxonomy, and genre tags on videos and channels from our own three-level Arabic genre taxonomy (for example Food › Baking & Desserts › Oriental Sweets). These are additive to YouTube's video category, shown as our tags, and never displayed as a YouTube category.
> 3. Custom channel scores and comparison (policy §1, §5): an explainable similarity score between a customer's channel and other public channels they choose to track (genre similarity, language, size proximity, recent activity), with a plain-language reason for each suggestion, and side-by-side public statistics for those channels. Comparisons are framed as benchmarking, never as rivalry, and are visible only inside the customer's workspace.
>
> Storage: we ask to keep public statistics (views, likes, comment counts, subscriber counts) as daily snapshots, and the derived metrics above, for up to 36 calendar months. Comment text, author names and ids, video titles and descriptions stay on the 30-day refresh-and-delete cycle that the service already enforces with an automated daily purge.

### C. (اختياري، قرارك) تقاطع الجمهور

هذه الميزة في المرحلة 3 من الخارطة. السياسة الأساسية تمنع «Estimate audience affinities». وأمثلة الملحق **لا تذكرها صراحة**، فلا أعرف إن كانت ستُقبل.

توصيتي: أضفها إلى الفقرة B بوصف دقيق. الرفض في هذه النقطة الآن أهون من بناء ميزة غير مسموحة. وإن قررت تأجيلها، فلا تُبنى المرحلة 3 قبل طلب لاحق.

> 4. Engaged-audience overlap: for two channels inside the same workspace, the number and share of distinct commenters who commented on both within a rolling 30-day window, computed from keyed one-way hashes of commenter ids that are deleted after 30 days. Only aggregate counts and ratios are stored and shown; no individual commenter is ever shown, profiled or followed across channels, and no protected attribute is inferred.

### D. إن سألوا عن مكان البيانات والحذف

> Data is stored in a Supabase Postgres project in **[REGION — confirm in Supabase › Project Settings › General]**, isolated per workspace by row-level security. Comment text and author identifiers are purged automatically 30 days after collection. A user can disconnect a channel in the app or at myaccount.google.com/connections; a revoked grant stops all reads immediately. Full deletion of an account or workspace is available on request by email and completed within 7 days.

## 3. بعد القبول

- **أخبرني بالقبول ونطاقه.** ما قُبل فقط يُفعَّل.
- ثم ثلاث خطوات، كلها بطلبات دمج:
  1. تمديد حفظ `channel_stats_daily` إلى 36 شهرًا؛
  2. تشغيل مفتاح `genre_classification`؛
  3. ذكر حفظ الإحصاءات 36 شهرًا وتصنيفاتنا في سياسة الخصوصية (المهمة 0.5).
- **وإن رُفض جزء منه:** نعدّل الخطة قبل بناء ذلك الجزء.
