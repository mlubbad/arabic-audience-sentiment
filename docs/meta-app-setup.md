# تشغيل قنوات فيسبوك وانستغرام حيًّا: تطبيق Meta، الأسرار، Apify، ومراجعة التطبيق

دليل المالك لتشغيل ما بُني في PR #133 (`claude/meta-channels`). كل خطوة هنا تحتاج حسابك أنت
(Meta، Supabase، Apify)، ولذلك لا ينفّذها أي وكيل. القيم الثابتة لمشروعك مكتوبة كما هي؛ الأسرار
لا تُكتب في هذا الملف ولا في أي ملف متتبَّع ولا في المحادثة (قاعدة `AGENTS.md`).

## 0. القيم الثابتة التي ستحتاجها

| البند | القيمة |
| --- | --- |
| مرجع مشروع Supabase | `ykqugctewsqvevhyqtbi` |
| رابط العودة الواحد لكلا البابين (`META_REDIRECT_URI`) | `https://ykqugctewsqvevhyqtbi.supabase.co/functions/v1/oauth-callback` |
| نطاق التطبيق | `app.sky-develop.net` |
| سياسة الخصوصية | `https://app.sky-develop.net/privacy` (عربي) و`https://app.sky-develop.net/en/privacy` (إنجليزي) |
| رابط تعليمات حذف البيانات (تطلبه Meta) | `https://app.sky-develop.net/en/privacy#retention` |
| الصلاحيات (فيسبوك) | `pages_show_list`, `pages_read_engagement`, `pages_read_user_content` |
| الصلاحيات (انستغرام) | `instagram_business_basic`, `instagram_business_manage_comments` |

الترتيب مهم: **ادمج PR #133 أولًا** حتى يطبّق CI الهجرة `20261026000000_meta_oauth_providers.sql`
على قاعدة البيانات، ثم انشر الدوال، ثم اضبط الأسرار، ثم جرّب. نشر `oauth-start` الجديدة قبل الهجرة
يكسر زر ربط يوتيوب نفسه (الدالة تمرّر `p_provider` إلى RPC لا يعرفه بعد).

## 1. إنشاء تطبيق Meta (مرة واحدة)

1. افتح [developers.facebook.com](https://developers.facebook.com) بحساب فيسبوك الذي يدير صفحتك،
   ثم **My Apps → Create App**.
2. في "ما الذي تريد أن يفعله تطبيقك؟" اختر حالة الاستخدام التي تسمح بإضافة **Facebook Login for
   Business** و**Instagram** (في الواجهة الحالية: *Other* ثم نوع التطبيق **Business**). اربطه
   بحافظة أعمال (Business Portfolio) باسم شركتك؛ ستحتاجها لاحقًا لتوثيق الأعمال.
3. اسم التطبيق: اسم المنتج كما يراه المستخدم عند الموافقة (مثل "Sky Develop Audience Sentiment").
4. **App settings → Basic**: انسخ **App ID** و**App Secret** (هما `META_APP_ID` و`META_APP_SECRET`).
   في الصفحة نفسها املأ: Privacy Policy URL، Terms of Service URL (`/en/terms`)، **User data
   deletion** → "Data deletion instructions URL" بالرابط أعلاه، App icon، Category، وفي **App
   domains** ضع `app.sky-develop.net`. احفظ.

## 2. باب فيسبوك: Facebook Login

1. **Add product → Facebook Login for Business → Set up**.
2. **Facebook Login → Settings**:
   - Client OAuth login: **On**. Web OAuth login: **On**.
   - **Valid OAuth Redirect URIs**: ألصق رابط العودة من الجدول أعلاه حرفيًا (بالـ `https` ودون شرطة
     مائلة في النهاية). "Use Strict Mode for redirect URIs": On.
   - Login with the JavaScript SDK: Off (لا نستخدمه).
3. لا تضف نطاقات أخرى. الكود يطلب الصلاحيات الثلاث فقط ويقرأ ولا يكتب.

## 3. باب انستغرام: Instagram API with Instagram Login

1. **Add product → Instagram → "API setup with Instagram login" → Set up**.
2. في قسم **Set up Instagram business login**:
   - **Business login settings → Redirect URIs**: الرابط نفسه (`.../oauth-callback`).
   - انسخ **Instagram app ID** و**Instagram app secret** من هذه الصفحة. هما **غير** App ID/Secret
     في الخطوة 1 (Meta تصدر زوجًا مستقلًا لانستغرام)، وهما `INSTAGRAM_APP_ID` و
     `INSTAGRAM_APP_SECRET`.
3. أضف حساب انستغرام التجريبي في **Instagram testers** (الحساب يجب أن يكون **مهنيًّا**: Business
   أو Creator، من إعدادات انستغرام → نوع الحساب). الحساب الشخصي يُرفض بالرمز
   `instagram_not_professional`.

## 4. وضع الأسرار على Supabase ونشر الدوال

على جهازك، من مجلد المشروع، وبعد دمج PR #133 وسحب `main`:

1. اكتب الأسرار في ملف مؤقت **خارج المستودع** (مثل `~/meta-secrets.env`، لا داخل المشروع):

```
META_APP_ID=...
META_APP_SECRET=...
META_REDIRECT_URI=https://ykqugctewsqvevhyqtbi.supabase.co/functions/v1/oauth-callback
INSTAGRAM_APP_ID=...
INSTAGRAM_APP_SECRET=...
```

2. ارفعها:

```bash
npx supabase secrets set --project-ref ykqugctewsqvevhyqtbi --env-file ~/meta-secrets.env
```

3. انشر الدوال الأربع التي تغيّرت. `oauth-callback` تُنشر دائمًا بـ `--no-verify-jwt` لأن Meta
   (كما Google) تعيد المتصفح إليها بلا رمز Supabase؛ نشرها دون العلم يعطّل ربط يوتيوب أيضًا:

```bash
npx supabase functions deploy oauth-start --project-ref ykqugctewsqvevhyqtbi
```

```bash
npx supabase functions deploy oauth-callback --no-verify-jwt --project-ref ykqugctewsqvevhyqtbi
```

```bash
npx supabase functions deploy worker --project-ref ykqugctewsqvevhyqtbi
```

```bash
npx supabase functions deploy channel-lookup --project-ref ykqugctewsqvevhyqtbi
```

4. احذف الملف المؤقت: `rm ~/meta-secrets.env`. تحقّق بـ `npx supabase secrets list --project-ref
   ykqugctewsqvevhyqtbi` أن الأسماء الخمسة ظاهرة (القيم لا تُعرض).

## 5. رمز Apify على العامل (المسار العام)

1. في [console.apify.com](https://console.apify.com) → **Settings → API & Integrations** → انسخ
   **Personal API token**. في **Settings → Limits** ضع سقفًا شهريًّا للإنفاق (مثلًا 10 دولارات) قبل
   أي شيء آخر؛ الخطة المجانية تمنح 5 دولارات شهريًّا تكفي لتجربة.
2. أضف إلى `.env.local` على جهازك (الملف غير متتبَّع):

```
APIFY_API_TOKEN=...
FACEBOOK_SCRAPER_PROVIDER=apify
INSTAGRAM_SCRAPER_PROVIDER=apify
```

   (أسماء الممثلين لها قيم افتراضية؛ `.env.example` يسردها إن أردت تبديلها.)
3. العامل على Oracle يقرأ `.env` المنسوخ من `.env.local` (انظر `docs/cloud-worker-deployment.md`).
   بعد الدمج، انسخ الملف وأعد البناء لأن كود العامل تغيّر:

```bash
scp -i ~/.ssh/oracle_vm .env.local ubuntu@<IP>:~/arabic-audience-sentiment/.env
```

```bash
ssh -i ~/.ssh/oracle_vm ubuntu@<IP> 'cd ~/arabic-audience-sentiment && git pull && docker compose up -d --build && docker compose logs --tail=20'
```

   سطر `worker up ... scrapers=yes` في السجل يعني أن الرمز وصل.

## 6. التجربة الأولى (قبل مراجعة التطبيق)

ما دام التطبيق في وضع التطوير، يعمل الربط لحسابات **مسؤولي التطبيق ومختبريه فقط** (Standard
Access). هذا يكفي للتحقق من كل المسار بصفحتك وحسابك.

1. **Roles → Testers**: أضف حساب فيسبوك الذي يدير الصفحة، وحساب انستغرام المهني.
2. في الموقع، بطاقة مساحة العمل → **ربط صفحة فيسبوك** → وافق → يجب أن تعود إلى `/connected` بنجاح،
   وتظهر الصفحة باسمها وشارة "فيسبوك"، ويُجدوَل اكتشاف المنشورات تلقائيًّا.
   - `meta_no_page`: الحساب لا يدير أي صفحة. `ambiguous_channel`: يدير أكثر من صفحة (القيد
     الحالي: صفحة واحدة لكل ربط). `meta_scope_missing`: رُفضت صلاحية في شاشة الموافقة.
3. كرّر بـ **ربط حساب انستغرام**.
4. المسار العام: **لا أملك القناة → انستغرام** → ألصق رابط حساب عام → "بحث" يجب أن يعيد الاسم
   والصورة (أو المعرّف وحده إن حجبت انستغرام القراءة من خادم Supabase؛ الإضافة تبقى ممكنة).
5. راقب صفحة المزامنة وسجل العامل: المسار العام يسجّل `source=facebook_apify` /
   `instagram_apify`، وباب المالك `facebook_graph_api` / `instagram_graph_api`.

## 7. مراجعة التطبيق (App Review) لحسابات لا تديرها

مطلوبة فقط حين يربط **عميل** صفحته أو حسابه بنفسه. المسار العام (Apify) لا يحتاجها.

**المتطلبات قبل التقديم**
- **توثيق الأعمال**: Meta Business Suite → Settings → Security Center → Business verification
  (سجل تجاري أو ما يعادله، ونطاق/بريد باسم الشركة). بدونه لا يُمنح Advanced Access.
- التطبيق في وضع **Live** (App settings → Basic → App Mode)، وسياسة الخصوصية ورابط حذف البيانات
  محفوظان (الخطوة 1).
- حساب فيسبوك وحساب انستغرام مهني للاختبار يملكان محتوى حقيقيًّا (منشورات وتعليقات) لتصوير الفيديو.

**التقديم**
1. **App Review → Permissions and Features**: اطلب **Advanced Access** للصلاحيات الخمس في الجدول
   أعلاه، لا أكثر.
2. لكل صلاحية اكتب الاستخدام بالإنجليزية بجملة واضحة. صياغة مطابقة لما يفعله الكود:
   > "We read the posts and comments of Facebook Pages / Instagram professional accounts that the
   > signed-in user administers, and show them sentiment and topic analytics of their audience's
   > comments inside our dashboard. We never publish, reply, delete or hide content."
3. **فيديو شاشة** لكل منصة: تسجيل الدخول للموقع → زر الربط → شاشة موافقة Meta → العودة إلى
   `/connected` → لوحة المتابعة تعرض التعليقات والمشاعر. Meta ترفض الفيديوهات التي لا تُظهر
   الصلاحية وهي تُستخدم فعلًا.
4. وفّر لمراجع Meta حساب اختبار على الموقع (بريد وكلمة مرور لحساب تجريبي **تنشئه لهذا الغرض**،
   تُكتب في نموذج المراجعة فقط).
5. المدة المعتادة أيام إلى أسابيع؛ الرفض يأتي بسبب مكتوب، وغالبًا يكون الفيديو أو نص الاستخدام.

## 8. ما يبقى خارج هذا الدليل

- منتقي الصفحات لمن يدير أكثر من صفحة، وتوسيع صفحة "صحة الخدمات" للمنصّتين، ودعم
  `diagnostics.py --platform facebook|instagram`: مؤجّلة ومسجّلة في `docs/decisions.md`.
- أي رمز أو سر يُرسل في محادثة أو قضية GitHub يُعتبر مُسرَّبًا ويجب تدويره فورًا.
