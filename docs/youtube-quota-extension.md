# طلب تمديد حصة YouTube Data API

2026-09-16. الحصة الافتراضية **10,000 وحدة/يوم لمشروع Google كله**، لا لكل مستخدم. هذه
الوثيقة تجهّز طلب التمديد (نموذج التدقيق والامتثال) بإجابات مكتوبة من الكود لا من الذاكرة.
**التقديم بيد مالك مشروع Google** (engmlubbad@gmail.com)؛ ما هنا هو ما يُلصق في النموذج.

## 0. قبل التقديم — ثلاثة شروط لم تكن متوفرة

| الشرط | الحال | ما يلزم |
| --- | --- | --- |
| سياسة خصوصية عامة | لم تكن موجودة | `/privacy-policy` في التطبيق (عربي/إنجليزي)، مربوطة من الصفحة الرئيسية — بُنيت 2026-09-16 (`95a6796`) |
| شروط الاستخدام | لم تكن موجودة | `/terms` كذلك (و`/third-party` لمكوّنات الطرف الثالث)، وفيها الإشارة إلى [YouTube Terms of Service](https://www.youtube.com/t/terms) و[Google Privacy Policy](https://policies.google.com/privacy) كما تشترط API Services Terms |
| صفحة عامة يستطيع المدقّق فتحها | `app.sky-develop.net` خلف كلمة مرور | إمّا رفع كلمة المرور عن `/`, `/pricing`, `/privacy-policy`, `/terms` فقط، أو نشر الصفحة الرئيسية على نطاق عام قبل التقديم. المدقق **يفتح الرابط**؛ صفحة 401 ترفض الطلب |

الرابط: **YouTube API Services – Audit and Quota Extension Form**
<https://support.google.com/youtube/contact/yt_api_form>. المراجعة تستغرق أسابيع وقد
تأتي بأسئلة متابعة؛ التدقيق يتكرر دوريًا بعد القبول.

## 1. الأرقام التي يقوم عليها الطلب

تكلفة النقاط المستخدمة (وحدة لكل استدعاء إلا ما ذُكر):

| النقطة | متى | التكلفة |
| --- | --- | --- |
| `channels.list(mine=true)` | مرة عند الربط | 1 |
| `playlistItems.list` | اكتشاف الكتالوج | 1 لكل 50 فيديو |
| `videos.list(part=snippet,statistics,contentDetails)` | الاكتشاف، وكشف التغيير في الفحص الحيّ | 1 لكل 50 فيديو |
| `commentThreads.list` | القراءة | 1 لكل 100 تعليق |
| `comments.list` | الردود | 1 لكل صفحة ردود |

مقاس على القناة الأولى (AJ360، 2026-09-15): الاكتشاف 4,456 فيديو ≈ 12 وحدة في 78 ثانية.

| الحمل | قبل كشف التغيير | بعد كشف التغيير (`20260917080000`) |
| --- | --- | --- |
| ربط قناة + اكتشاف قناة كبيرة (4,500 فيديو) | ≈ 180 | ≈ 180 |
| أول قراءة لقناة كبيرة (167k تعليق) | ≈ 1,700 | ≈ 1,700 |
| فحص حيّ يومي، خطة `creator` (فيديو واحد… 20 فيديو، فحص/يوم) | 20 | 1 + الجديد |
| فحص حيّ، خطة `agency` (10 قنوات × 20 فيديو × 4 فحوص) | 800 | 16 + الجديد |
| فحص حيّ، خطة `media` (30 قناة × 20 × 12 فحصًا) | 7,200 | 144 + الجديد |

الحالة المستقرة لـ100 مشترك متوسط ≈ 600–1,500 وحدة/يوم. ما يكسر السقف هو **يوم انضمام**
فيه قناتان أو ثلاث كبيرة (كل واحدة ≈ 1,900 وحدة) فوق الحمل اليومي، أو وكالة `media`
واحدة قبل كشف التغيير. المطلوب: **50,000 وحدة/يوم** — يغطي خمس قنوات كبيرة في يوم واحد
مع 300 مشترك.

## 2. إجابات النموذج (بالإنجليزية كما يُقدَّم)

**Project / application name:** Arabic Audience Sentiment (مشاعر الجمهور) — Google Cloud
project of the OAuth client used by `oauth-start`.

**What does your application do?**
An Arabic-first audience-monitoring dashboard for YouTube creators, marketing agencies and
media companies. A channel owner connects their own channel with OAuth; the service reads
the channel's public video list and the comments and replies on the videos the owner
selects, classifies each comment's sentiment (an Arabic model run on our own server) and
topic, and shows the owner trends, comparisons between videos and the underlying comments.
Nothing is written to YouTube. No data from channels the user does not own is read
through their token.

**Which API endpoints do you use, and why?**
- `channels.list` (`mine=true`) once at connection, to identify the channel the token
  belongs to — ownership is decided by this response, never by a typed URL.
- `playlistItems.list` on the uploads playlist and `videos.list`
  (`snippet,statistics,contentDetails`) to catalogue the channel's videos and their
  reported comment counts, so the owner can choose which videos to monitor.
- `commentThreads.list` and `comments.list` to read comments and replies on the selected
  videos. Before each scheduled read, `videos.list(part=statistics)` is called for the due
  videos (50 per unit) and a video whose comment count has not moved is not read.
- No insert/update/delete endpoints are called.

**Which OAuth scopes, and why?**
(As submitted 2026-09-16. Since 2026-09-18 the client requests `youtube.force-ssl` alone —
`readonly` is a subset of it and was dropped after the OAuth-verification reviewer's
least-privilege objection; see `docs/oauth-verification.md` §5. If the quota reviewers ask,
that is the answer.)
`https://www.googleapis.com/auth/youtube.readonly` and
`https://www.googleapis.com/auth/youtube.force-ssl`. `commentThreads.list` on the owner's
own videos refuses `youtube.readonly` alone with `insufficientPermissions`; Google offers
no narrower scope that permits reading comments as the owner, so `force-ssl` is requested
although the application performs no write. This is documented in the source
(`supabase/functions/oauth-start/index.ts`).

**How do users authorize access, and how do they revoke it?**
Through Google's consent screen, started from the account page of a signed-in workspace
owner. Tokens are encrypted at rest (AES-GCM, key held only by the server); the worker
that reads YouTube never holds the refresh token — it receives a one-hour access token per
job. A user revokes from Google's account permissions page or by disconnecting the channel
in the application; an `invalid_grant` answer marks the connection revoked and cancels
pending work immediately.

**What data do you store, for how long, and how do users delete it?**
Video metadata (id, title, published date, reported counts), comment metadata (id, author
channel id, published date, like count), comment text, and the labels our own models
attach. Comment **text** is purged automatically 30 days after collection (`purge_comment_text`,
scheduled daily); counts and metadata are refreshed on every check; derived labels are our
own data and are kept for the owner's history. A disconnected channel stops all reads. A
user may request deletion of a workspace and all its data by email; deletion is completed
within 7 days. Data is stored in a Supabase Postgres project in the EU, isolated per
workspace by row-level security.

**Expected traffic (units/day):**
Today: one pilot channel, under 100 units/day. Planned: ~600–1,500 units/day at 100
subscribers in steady state; onboarding a large channel (~4,500 videos, ~170k comments)
costs ~1,900 units once. Peak day (five large onboardings + steady state) ≈ 12,000. Requested
quota: **50,000 units/day**, to keep onboarding days from failing other customers'
scheduled reads.

**Why is the default quota insufficient?**
Because the quota is per project, not per user: a single onboarding day for two or three
large channels reaches 10,000 and blocks every other customer's scheduled reads until
midnight Pacific.

**Compliance statements (tick/affirm):** the application displays a link to the YouTube
Terms of Service and the Google Privacy Policy on its terms page; it does not store
authorized data longer than 30 days without refreshing it (comment text is purged at 30
days; metadata is refreshed each check); it does not aggregate data across users' channels;
it does not sell data; it does not replace YouTube's own metrics; it shows YouTube data
alongside its own analysis, clearly labelled.

## 3. ما يُرفق

- روابط: الصفحة الرئيسية، `/privacy-policy`, `/terms`, `/pricing` — كلها يجب أن تفتح بلا كلمة مرور.
- لقطات: شاشة الربط (OAuth)، الكتالوج مع أعداد التعليقات، لوحة التعليقات، صفحة الحساب مع
  زر فصل القناة.
- فيديو قصير (يطلبونه أحيانًا): الربط → الاكتشاف → اختيار الفيديوهات → القراءة → اللوحة.

## 4. ما ليس في التطبيق بعد وقد يسألون عنه

- **فصل القناة من الواجهة**: الإبطال يُعالَج عند `invalid_grant`، وزر «فصل» في صفحة الحساب
  يجب أن يوجد قبل التقديم (يُنشئ `status='revoked'` ويلغي المهام — الدالة موجودة في
  `20260913150000`).
- **حذف الحساب ذاتيًّا**: بالبريد اليوم؛ زر حذف في الحساب لاحقًا.
- **تحديث البيانات كل 30 يومًا**: نص التعليقات يُطهَّر؛ أما بيانات الفيديو الوصفية فتُحدَّث
  عند كل فحص حيّ فقط للفيديوهات المختارة — الفيديوهات غير المختارة تبقى بلقطة الاكتشاف
  حتى الاكتشاف التالي (`catalogue_interval_minutes`، يومي في `creator`، 6 ساعات في
  `media`). هذا يفي بالشرط.
