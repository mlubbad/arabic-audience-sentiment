# دليل نشر وتشغيل عامل البايثون سحابياً (24/7 Cloud Worker Deployment)

هذا الدليل يوضح كيفية تشغيل عامل البايثون السحابي على مدار الساعة (24/7) دون الحاجة لتشغيل جهازك الشخصي أو إبقائه مفتوحاً.

---

## 1. المتطلبات السحابية (متغيرات البيئة)

العامل السحابي يحتاج المتغيرات التالية المسجلة لديك في `.env.local` للاتصال بـ Supabase وقنوات التواصل:

| اسم المتغير | الوظيفة | أين تجده؟ |
| :--- | :--- | :--- |
| `WORKER_API_BASE_URL` | عنوان دالة Supabase Edge Function | `https://ykqugctewsqvevhyqtbi.supabase.co/functions/v1/worker` |
| `WORKER_CREDENTIAL` | المفتاح السري المخصص للعامل للمصادقة مع قاعدة البيانات | من ملف `.env.local` |
| `SENTIMENT_MODEL` | نموذج تحليل المشاعر العربي الافتراضي | `camelbert-da` |
| `TOPIC_MODEL` | نموذج تصنيف المواضيع بالذكاء الاصطناعي | `gemini` |
| `GEMINI_API_KEY` | مفتاح Google Gemini API لتصنيف المواضيع | من ملف `.env.local` |
| `YOUTUBE_API_KEY` | مفتاح YouTube Data API v3 للقنوات العامة | من ملف `.env.local` |
| `TELEGRAM_API_ID` | معرف تطبيق تليجرام | `18186196` |
| `TELEGRAM_API_HASH` | المفتاح السري لتطبيق تليجرام | من ملف `.env.local` |
| `TELEGRAM_SESSION_STRING` | جلسة تليجرام الموثقة لقراءة المجموعات والردود | من ملف `.env.local` |

---

## 1.5 الخيار المعتمد (2026-10-12): Oracle Cloud Always Free، منطقة Frankfurt

قرار المالك: يعمل العامل على جهاز Oracle المجاني (معالج ARM من نوع Ampere A1). الصورة تُبنى وتُختبر على المعمارية نفسها في كل تغيير على العامل، عبر `.github/workflows/worker-image.yml`، الذي يحمّل النموذج ويصنّف به داخل الصورة.

> **تحقق قبل الاعتماد:** حدود الخطة المجانية وسياساتها تتغير. ما يلي يصف ما أعرفه حتى منتصف 2026، فراجع صفحة Oracle Always Free الحالية.
> - الحد المعروف لأجهزة A1 المجانية هو 4 أنوية و24 غيغابايت ذاكرة في المجموع.
> - تذكر Oracle أنها قد تستعيد جهازًا مجانيًا يبقى خاملًا 7 أيام (استهلاك منخفض للمعالج والشبكة والذاكرة). عاملنا يمضي معظم وقته منتظرًا، فراقب ذلك. الترقية إلى Pay As You Go تُسقط هذه الاستعادة وتبقي الموارد المجانية مجانية، لكنها تفتح باب الدفع إن تجاوزت الحدود.

### أ. إنشاء الجهاز (مرة واحدة، من لوحة Oracle)
1. على جهازك (Mac) أنشئ مفتاح SSH خاصًا بهذا الخادم:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/oracle_worker -C oracle-worker
   ```
2. في لوحة Oracle: **Compute ← Instances ← Create instance**.
   - **Image:** Canonical Ubuntu 24.04 (نسخة aarch64).
   - **Shape:** Ampere ← `VM.Standard.A1.Flex` بنواة واحدة و6 غيغابايت (اختيار المالك، 2026-10-13). العامل يستهلك نحو 1.5 إلى 2 غيغابايت. على 6 غيغابايت يبقى استهلاك الذاكرة فوق 20%، فلا يُعدّ الجهاز خاملًا بمعيار الذاكرة في قاعدة الاستعادة. على 12 غيغابايت ينزل تحتها. (تحقق من نص القاعدة الحالي.)
   - **Networking:** الشبكة الافتراضية مع عنوان IP عام.
   - **Add SSH keys:** الصق محتوى `~/.ssh/oracle_worker.pub`، المفتاح العام فقط.
   - **Boot volume:** 50 غيغابايت.
3. إن ظهرت رسالة `Out of host capacity` فهي نفاد مؤقت في المنطقة. أعد المحاولة لاحقًا، أو جرّب نواة واحدة و6 غيغابايت. لا تفتح حسابًا ثانيًا، فذلك مخالف لشروط Oracle.
4. **المنافذ:** العامل يتصل بالخارج فقط ولا يستقبل شيئًا، فلا تفتح أي منفذ غير SSH (22). وإن أمكن، قيّد SSH بعنوانك في Security List.

### ب. تجهيز الخادم (مرة واحدة)
```bash
ssh -i ~/.ssh/oracle_worker ubuntu@<IP>
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu && exit   # اخرج ثم ادخل مجددًا ليسري الإذن
ssh -i ~/.ssh/oracle_worker ubuntu@<IP>
git clone https://github.com/mlubbad/arabic-audience-sentiment.git
```

### ج. الأسرار (من جهازك، لا تلصقها في أي محادثة)
انسخ ملف الأسرار باسم `.env` تحديدًا. هذا الاسم يقرؤه Compose في الحالتين، وكان غيابه يفرّغ بيانات الاعتماد قبل إصلاح 2026-10-12:
```bash
scp -i ~/.ssh/oracle_worker .env.local ubuntu@<IP>:~/arabic-audience-sentiment/.env
ssh -i ~/.ssh/oracle_worker ubuntu@<IP> chmod 600 ~/arabic-audience-sentiment/.env
```
يحتاج العامل على الأقل `WORKER_API_BASE_URL` و`WORKER_CREDENTIAL`، والباقي حسب المنصات المفعّلة (جدول القسم 1).

### د. التشغيل
```bash
cd ~/arabic-audience-sentiment
docker compose up -d --build     # البناء الأول بضع دقائق (torch)
docker compose logs -f           # اخرج بـ Ctrl+C، العامل يبقى يعمل
```
السجل الصحيح يظهر بهذا الترتيب:
- `loading the classifier (camelbert-da)`
- `loaded CAMeL-Lab/bert-base-arabic-camelbert-da-sentiment@b0df630d23e5`
- ثم سطر `worker up …`

التنزيل الأول للنموذج (نحو 500 ميغابايت) يُحفظ في وحدة التخزين `hf-cache`، فلا يتكرر بعدها.

### هـ. التحديث بعد كل دمج يغيّر العامل
```bash
cd ~/arabic-audience-sentiment && git pull && docker compose up -d --build
```

### و. بعد التأكد: جهازك احتياط جاهز (standby)
لا تُزل عامل جهازك. يبقى مثبتًا ومعطّلًا، ويعمل وحده إن تعطّل Oracle. ثبّت الاحتياط فقط بعد أن يُظهر سجل Oracle سطر `loaded CAMeL-Lab/...`.

**كيف يعمل:**
- وكيل launchd اسمه `com.skydevelop.sentiment-standby` يفحص كل 5 دقائق أن حاوية Oracle تعمل.
- فحصان فاشلان متتاليان (نحو 10 دقائق) يشغّلان عامل جهازك مع إشعار macOS.
- فحصان ناجحان متتاليان يوقفانه بعد أن يُنهي المهمة التي في يده، ثم يعطّلانه كي لا يعمل عند تسجيل الدخول.
- التداخل لحظة التبديل آمن: المهمة تُحجز حصريًا (`for update skip locked` مع مهلة 5 دقائق)، فلا يأخذ عاملان المهمة نفسها.

**1. مفتاح فحص لا يستطيع إلا الفحص.** على جهازك:
```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/oracle_standby -C standby-probe
cat ~/.ssh/oracle_standby.pub
```
ثم على الخادم افتح `nano ~/.ssh/authorized_keys` وأضف سطرًا جديدًا بهذا الشكل، بعد أن تستبدل `ssh-ed25519 AAAA...` بما طبعه الأمر السابق:
```
command="docker inspect -f '{{.State.Running}} {{.State.Restarting}}' sentiment-worker",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... standby-probe
```
هذا المفتاح بلا كلمة مرور لأن الوكيل يعمل دون تدخل، لكن الخادم يقيّده بأمر واحد يقرأ حالة الحاوية فقط. لو تسرّب لا يفتح أي وصول آخر. للتجربة:
```bash
ssh -i ~/.ssh/oracle_standby ubuntu@<IP>     # يجب أن يطبع: true false
```

**2. الإعداد والتثبيت** (من مجلد المشروع على جهازك):
```bash
mkdir -p ~/Library/Application\ Support/sentiment-worker
printf 'ORACLE_HOST=%s\nORACLE_KEY=%s\n' '<IP>' "$HOME/.ssh/oracle_standby" \
  > ~/Library/Application\ Support/sentiment-worker/standby.env
git pull && sh scripts/worker-standby-install.sh
```

**3. المتابعة:**
```bash
cat ~/Library/Application\ Support/sentiment-worker/standby.state   # standby 0 N، والرقم الأخير يزيد كل 5 دقائق
cat ~/Library/Application\ Support/sentiment-worker/standby.log     # سطر لكل تبديل فقط
```

**4. تمرين مرة واحدة للتأكد:**
- على الخادم نفّذ `docker compose stop`. خلال 10 دقائق تقريبًا يصلك إشعار ويعمل عامل جهازك.
- ثم نفّذ `docker compose start`. خلال 10 دقائق أخرى يعود جهازك احتياطًا.

**الإزالة**، فيعود جهازك هو العامل الأساسي:
```bash
sh scripts/worker-standby-install.sh --remove
```

**حدود معروفة:**
- الاحتياط يعمل ما دام جهازك مستيقظًا ومسجَّل الدخول. الحاسوب المغلق ليس احتياطًا.
- إن انقطع إنترنت جهازك وحده، سيظن أن Oracle توقف فيشغّل عامله. الضرر الوحيد استهلاك موارد زائد، لا تكرار في المعالجة.

---

## 2. بديل: منصة Render (مدفوعة للعمال الخلفيين)

منصة **[Render](https://render.com)** توفر خياراً متخصصاً لتشغيل العمال الخلفيين (**Background Worker**) بشكل سحابي كامل ومستقل.

### خطوات التشغيل (بضغطة زر):
1. ادخل إلى لوحة تحكم ريندر: **[dashboard.render.com](https://dashboard.render.com)**
2. اضغط على زر **New +** ثم اختر **Background Worker**.
3. اختر ربط مستودع GitHub الخاص بالمشروع (`arabic-audience-sentiment`).
4. اضبط الإعدادات التالية في الصفحة:
   - **Name**: `sentiment-worker`
   - **Region**: `Frankfurt (EU Central)` (الأقرب لسرعة الاتصال بالشرق الأوسط وسيرفرات Supabase).
   - **Environment**: اختر **Docker**.
   - **Dockerfile Path**: `./workers/python/Dockerfile`
   - **Docker Context**: `./workers/python`
   - **Instance Type**: الحاوية تحمّل النموذج منذ 2026-10-12 وتحتاج نحو 1.5 غيغابايت ذاكرة على الأقل؛ خطة Starter (512 ميغابايت) لم تعد تكفي.
5. في قسم **Environment Variables** (المتغيرات البيئية):
   - اضغط **Add Environment Variable** وأضف المتغيرات المذكورة في الجدول أعلاه مع قيمها من `.env.local`.
6. اضغط على زر **Create Background Worker**.

> 💡 **النتيجة**:
> ستقوم Render ببناء الحاوية فوراً وتشغيلها. ستظهر لك شاشة السجلات الحية (**Live Logs**) توضح:
> `worker up, model=camelbert-da, tenants=1, topics=gemini, public=yes, telegram_auth=yes`
> وسيبدأ العامل بمراقبة قاعدة بيانات Supabase وسحب وتحليل أي وظيفة فور إنشائها.

---

## 3. خيار النشر الثاني: منصة Railway

إذا كنت تفضل منصة **[Railway.com](https://railway.com)**:
1. ادخل إلى **[railway.com](https://railway.com)** وسجل الدخول بحساب GitHub.
2. اضغط **New Project** -> **Deploy from GitHub repo**.
3. اختر المستودع.
4. اذهب إلى **Settings** -> في خانة **Root Directory** ضع: `workers/python`.
5. في خانة **Variables** أضف المتغيرات البيئية من الجدول أعلاه.
6. سيبدأ البناء تلقائياً وسيعمل العامل 24/7.

---

## 4. خيار النشر الثالث: سيرفر VPS خاص عبر Docker Compose

إذا كان لديك سيرفر افتراضي خاص (VPS) يدعم Docker:
1. ارفع المشروع إلى السيرفر:
   ```bash
   git clone <REPO_URL>
   cd SentimentAnalysis
   ```
2. ضع ملف `.env.local` على السيرفر في المجلد الرئيسي.
3. شغل الحاوية بأمر واحد:
   ```bash
   docker compose up -d --build
   ```
4. لمتابعة السجلات والتأكد من عمله:
   ```bash
   docker compose logs -f
   ```

---

## 5. كيف تتأكد من عمل العامل السحابي بكفاءة؟

1. **في لوحة تحكم Render/Railway**: ستشاهد رسائل السجل (Logs) تظهر استهلاك المهام دون أي توقف أو أخطاء.
2. **في لوحة تحكم التطبيق**:
   - عند طلب سحب قناة يوتيوب أو تليجرام، ستتحول حالة الوظيفة تلقائياً من `queued` إلى `running` ثم `succeeded` في الخلفية، حتى وإن أغلقت متصفحك أو جهازك تماماً!
