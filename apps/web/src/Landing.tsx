import { useEffect, useState } from "react";
import { Link } from "react-router";
import "./landing.css";
import { BrandMark } from "./BrandMark";

const examples = [
  {
    text: "شرح واضح، استفدت من الأمثلة كثيرًا 👏",
    label: "positive",
    name: "إيجابي",
  },
  {
    text: "المحتوى جميل، لكن المقدمة طويلة قليلًا",
    label: "mixed",
    name: "مختلط",
  },
  {
    text: "أتمنى توضيح المصادر في الحلقة القادمة",
    label: "neutral",
    name: "محايد",
  },
  { text: "الصوت غير واضح في هذا المقطع", label: "negative", name: "سلبي" },
] as const;
const colors = {
  positive: "#8470e9",
  negative: "#eb819a",
  neutral: "#a5b1c6",
  mixed: "#efbb65",
};
const numeral = new Intl.NumberFormat("ar", { numberingSystem: "arab" });
const audiences = {
  creator: {
    title: "فيديوك التالي يبدأ بالإنصات.",
    text: "ارجع إلى التعليقات التي تستحق انتباهك. قارن استقبال فيديوهاتك، وافهم أين يتفق جمهورك وأين تختلف آراؤه.",
    tags: ["قارن الفيديوهات", "راجع ردود الفعل", "خطّط للمحتوى"],
  },
  agency: {
    title: "لكل عميل جمهوره. ولكل جمهور صوته.",
    text: "قراءة واضحة لكل جمهور، وتقارير تحتفظ بالفلاتر التي بنيت عليها نتائجك. جرّب المراجعة والتصدير الآن؛ تجربة التنقّل بين العملاء ضمن تطوير النسخة الأولية.",
    tags: ["مساحات عمل مستقلة", "تقارير قابلة للتصدير", "مراجعة بشرية"],
  },
};

export function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState("all");
  const [audience, setAudience] = useState<keyof typeof audiences>("creator");
  const shown = examples.filter(
    (c) => selected === "all" || c.label === selected,
  );
  const shares = examples.map((c) => ({
    ...c,
    percent:
      (shown.filter((row) => row.label === c.label).length / shown.length) *
      100,
  }));
  useEffect(() => {
    const previous = document.title;
    document.title = "مشاعر الجمهور — افهم ما وراء تعليقات يوتيوب";
    return () => {
      document.title = previous;
    };
  }, []);
  return (
    <div className="landing" dir="rtl">
      <a className="lp-skip" href="#landing-content">
        انتقل إلى المحتوى
      </a>
      <div className="lp-announcement">
        صوت جمهورك، بوضوح أكبر <span>معاينة خاصة · نسخة تجريبية</span>
      </div>
      <header className="lp-header">
        <Link className="lp-brand" to="/" aria-label="مشاعر الجمهور — الرئيسية">
          <BrandMark /> مشاعر الجمهور<span className="lp-brand-dot">.</span>
        </Link>
        <button
          className="lp-menu"
          aria-label="القائمة الرئيسية"
          aria-expanded={menuOpen}
          aria-controls="landing-nav"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "إغلاق ×" : "القائمة ☰"}
        </button>
        <nav
          id="landing-nav"
          className={menuOpen ? "lp-nav is-open" : "lp-nav"}
          aria-label="تنقل صفحة الهبوط"
        >
          <a href="#why" onClick={() => setMenuOpen(false)}>
            لماذا مشاعر الجمهور؟
          </a>
          <a href="#experience" onClick={() => setMenuOpen(false)}>
            شاهد التجربة
          </a>
          <a href="#questions" onClick={() => setMenuOpen(false)}>
            أسئلة شائعة
          </a>
        </nav>
        <Link className="lp-header-cta" to="/account">
          فتح الحساب <span aria-hidden="true">↖</span>
        </Link>
      </header>
      <main id="landing-content" className="lp-main">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-youtube" aria-hidden="true">
                ▶
              </span>{" "}
              تعليقات يوتيوب. رؤية أوضح.
            </span>
            <h1 id="hero-title">
              وراء كل تعليق،
              <br />
              صوت يستحق
              <br />
              <em>أن تفهمه.</em>
            </h1>
            <p>
              لا تكتفِ بعدّ التعليقات. افهم مشاعر جمهورك، قارن فيديوهاتك، وارجع
              إلى الكلمات التي تصنع الفرق.
            </p>
            <div className="lp-actions">
              <Link className="lp-button" to="/dashboard">
                استكشف اللوحة <span aria-hidden="true">←</span>
              </Link>
              <a className="lp-text-link" href="#experience">
                شاهد كيف تعمل <span aria-hidden="true">↙</span>
              </a>
            </div>
            <p className="lp-caption">
              المثال المعروض هنا توضيحي؛ بيانات قناتك تتطلب تسجيل الدخول والربط.
            </p>
          </div>
          <div
            className="lp-hero-art"
            aria-label="تصوّر بصري لتحويل التعليقات إلى رؤية واضحة"
          >
            <div className="lp-art-halo" />
            <img
              src="/landing/audience-growth-original.png"
              width="1536"
              height="1024"
              alt=""
              fetchPriority="high"
            />
            <div className="lp-floating lp-floating-top">
              <span className="lp-spark">✦</span>
              <div>
                <b>أبعد من الإعجابات</b>
                <span>افهم ما يقوله جمهورك فعلًا</span>
              </div>
            </div>
            <div className="lp-floating lp-floating-bottom">
              <span className="lp-comment-icon">”</span>
              <div>
                <b>«جميل، لكن…»</b>
                <span>
                  <i className="lp-dot mixed" /> مشاعر مختلطة، وليست محايدة
                </span>
              </div>
            </div>
          </div>
          <div className="lp-hero-word" aria-hidden="true">
            صوت جمهورك
          </div>
        </section>
        <div className="lp-value-strip">
          <span>مصمّمة لفهم التعليقات العربية</span>
          <span>4 فئات للمشاعر</span>
          <span>من النظرة العامة إلى التعليق</span>
          <span>القرار الأخير لك</span>
        </div>

        <section className="lp-statement" id="why" aria-labelledby="why-title">
          <span className="lp-orbit lp-orbit-one" aria-hidden="true" />
          <span className="lp-orbit lp-orbit-two" aria-hidden="true" />
          <span className="lp-eyebrow">من ضجيج التعليقات إلى وضوح الصورة</span>
          <h2 id="why-title">
            المشاهدات تقول كم شخصًا وصل إليه محتواك.
            <br />
            <em>التعليقات تقرّبك مما شعروا به.</em>
          </h2>
          <p>
            اجمع قراءتك للمشاعر والمقارنات والتعليقات في مكان واحد، واحتفظ
            بالسياق خلف كل رقم.
          </p>
          <a className="lp-button lp-button-light" href="#experience">
            قرّب الصورة <span aria-hidden="true">↓</span>
          </a>
        </section>

        <section
          className="lp-section lp-experience"
          id="experience"
          aria-labelledby="experience-title"
        >
          <div className="lp-section-heading">
            <span className="lp-eyebrow">جرّب الفكرة</span>
            <h2 id="experience-title">
              صورة كاملة.
              <br />
              <em>وتفاصيل تستحق التوقف.</em>
            </h2>
            <p>
              اختر شعورًا لتقرأ مثالًا. هكذا تنتقل من ملخص الجمهور إلى التعليق
              نفسه.
            </p>
          </div>
          <div className="lp-demo-frame">
            <div className="lp-demo-top">
              <span>
                <BrandMark /> نظرة على الجمهور
              </span>
              <span className="lp-demo-label">
                مثال توضيحي · 4 تعليقات مؤلّفة
              </span>
            </div>
            <div className="lp-demo-content">
              <div className="lp-demo-chart">
                <span className="lp-mini-label">المشاعر ضمن الاختيار</span>
                <div
                  className="lp-donut"
                  role="img"
                  style={
                    selected === "all"
                      ? undefined
                      : { background: colors[shown[0].label] }
                  }
                  aria-label={shares
                    .map((c) => `${c.name}: ${numeral.format(c.percent)}٪`)
                    .join("، ")}
                >
                  <div>
                    <strong>{numeral.format(shown.length)}</strong>
                    <span>تعليقات ضمن الاختيار</span>
                  </div>
                </div>
                <div className="lp-legend">
                  {shares.map((c) => (
                    <span key={c.label}>
                      <i className={`lp-dot ${c.label}`} />
                      {c.name} <b>{numeral.format(c.percent)}٪</b>
                    </span>
                  ))}
                </div>
              </div>
              <div className="lp-demo-comments">
                <div
                  className="lp-demo-filters"
                  role="group"
                  aria-label="تصفية المثال حسب المشاعر"
                >
                  <button
                    aria-pressed={selected === "all"}
                    onClick={() => setSelected("all")}
                  >
                    الكل
                  </button>
                  {examples.map((c) => (
                    <button
                      key={c.label}
                      aria-pressed={selected === c.label}
                      onClick={() => setSelected(c.label)}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
                <div className="lp-comment-list" aria-live="polite">
                  {shown.map((c) => (
                    <div className="lp-example-comment" key={c.label}>
                      <span
                        className={`lp-avatar ${c.label}`}
                        aria-hidden="true"
                      >
                        {c.name[0]}
                      </span>
                      <p>{c.text}</p>
                      <span className={`lp-sentiment ${c.label}`}>
                        {c.name}
                      </span>
                    </div>
                  ))}
                </div>
                <Link className="lp-demo-link" to="/dashboard">
                  اكتشف الفلاتر والتصحيح والتصدير في اللوحة{" "}
                  <span aria-hidden="true">←</span>
                </Link>
              </div>
            </div>
          </div>
          <div className="lp-benefits">
            <div>
              <span>01 / افهم</span>
              <h3>المشاعر ليست لونين فقط.</h3>
              <p>
                إيجابي، سلبي، محايد، ومختلط. والتعليق غير المحلّل يظل واضحًا
                خارج نسب المشاعر.
              </p>
            </div>
            <div>
              <span>02 / قارن</span>
              <h3>ضع كل فيديو في سياقه.</h3>
              <p>
                غيّر الفيديو أو الفترة لترى النتائج ضمن نفس الفلاتر، ثم افحص
                التعليقات التي تقف خلفها.
              </p>
            </div>
            <div>
              <span>03 / راجع</span>
              <h3>خبرتك جزء من الصورة.</h3>
              <p>
                راجع التصنيف وصحّحه مع ذكر السبب. قراءة الآلة بداية، والمراجعة
                البشرية تمنحها سياقًا.
              </p>
            </div>
          </div>
        </section>

        <section className="lp-audience" aria-labelledby="audience-title">
          <div className="lp-section-heading">
            <span className="lp-eyebrow">مساحة لعملك، مهما كان دورك</span>
            <h2 id="audience-title">
              قريب من جمهورك.
              <br />
              مناسب لطريقة عملك.
            </h2>
          </div>
          <div
            className="lp-audience-tabs"
            role="group"
            aria-label="اختر طبيعة عملك"
          >
            <button
              aria-pressed={audience === "creator"}
              onClick={() => setAudience("creator")}
            >
              صنّاع المحتوى
            </button>
            <button
              aria-pressed={audience === "agency"}
              onClick={() => setAudience("agency")}
            >
              الوكالات والفرق
            </button>
          </div>
          <div className="lp-audience-panel" aria-live="polite">
            <div className="lp-audience-copy">
              <span className="lp-eyebrow">
                {audience === "creator" ? "لك ولجمهورك" : "لفريقك وعملائك"}
              </span>
              <h3>{audiences[audience].title}</h3>
              <p>{audiences[audience].text}</p>
              <div className="lp-tags">
                {audiences[audience].tags.map((tag) => (
                  <span key={tag}>✓ {tag}</span>
                ))}
              </div>
              <Link className="lp-text-link" to="/dashboard">
                استكشف تجربة العمل <span aria-hidden="true">←</span>
              </Link>
            </div>
            <div className="lp-workspace-art" aria-hidden="true">
              <div className="lp-workspace-window">
                <div className="lp-window-dots">● ● ●</div>
                <span className="lp-mini-label">
                  {audience === "creator" ? "مساحة قناتك" : "مساحة العميل"}
                </span>
                <div className="lp-video-row">
                  <span>▶</span>
                  <div>
                    <b>فهمٌ أعمق للمحتوى</b>
                    <i />
                  </div>
                </div>
                <div className="lp-mini-bars">
                  {[42, 76, 58, 92, 67, 84, 100].map((h, i) => (
                    <i key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="lp-window-note">
                  تصفية واحدة، صورة متّسقة <span>✓</span>
                </div>
              </div>
              <span className="lp-art-caption">
                تصوّر للواجهة · بيانات توضيحية
              </span>
            </div>
          </div>
        </section>

        <section className="lp-section lp-trust" aria-labelledby="trust-title">
          <div>
            <span className="lp-eyebrow">وضوح يمكنك البناء عليه</span>
            <h2 id="trust-title">
              الثقة تبدأ
              <br />
              بمعرفة <em>حدود البيانات.</em>
            </h2>
            <p>
              ليس كل تعليق متاحًا، وليس كل تصنيف يقينًا. لذلك نُظهر ما تم تحليله
              وما يحتاج مراجعة.
            </p>
          </div>
          <div className="lp-trust-items">
            <div>
              <span>◉</span>
              <h3>سياق خلف كل نسبة</h3>
              <p>
                تعرّف على التعليقات المحلّلة، والتواريخ غير المعروفة، ونطاق
                الفلاتر قبل تفسير النتائج.
              </p>
            </div>
            <div>
              <span>↻</span>
              <h3>حالة الجمع ظاهرة</h3>
              <p>التغطية الجزئية أو تعذّر الجمع لا تعني أن جمهورك لم يعلّق.</p>
            </div>
            <div>
              <span>↗</span>
              <h3>تقرير يعكس ما تراه</h3>
              <p>
                صدّر التعليقات وفق الفلاتر نفسها، مع الاحتفاظ بمصدر التصنيف وسجل
                المراجعة المتاح.
              </p>
            </div>
          </div>
        </section>

        <section
          className="lp-section lp-faq"
          id="questions"
          aria-labelledby="faq-title"
        >
          <div>
            <span className="lp-eyebrow">قبل أن تبدأ</span>
            <h2 id="faq-title">أسئلة في محلّها.</h2>
            <p>هذه نسخة تجريبية. إليك ما تستطيع تجربته الآن.</p>
          </div>
          <div className="lp-faq-list">
            {[
              [
                "هل البيانات في التجربة من قناة حقيقية؟",
                "المثال التفاعلي في هذه الصفحة يستخدم تعليقات اصطناعية معلّمة بوضوح. حُفظت تعليقات قناة اختبار حقيقية في الخدمة، ويجري توصيلها باللوحة الحية لصاحب مساحة العمل.",
              ],
              [
                "هل يمكنني ربط قناتي الآن؟",
                "ربط يوتيوب متاح ضمن التجربة الخاصة للحسابات المخوّلة، وقد جُمعت تعليقات حقيقية لقناة اختبار. تتطلب المزامنة تشغيل العامل، وما زال تحليل المشاعر بالنموذج الحي والتحقق من اللوحة الحية قيد الإكمال.",
              ],
              [
                "هل تحليل المشاعر دقيق دائمًا؟",
                "لا. السخرية واللهجات والسياق قد تجعل التصنيف ملتبسًا. لذلك تتضمن التجربة فئة للمشاعر المختلطة وتصحيحًا بشريًا؛ لم نعتمد بعد نتيجة دقة لنموذج حي.",
              ],
              [
                "هل تُحفظ تصحيحاتي في التجربة؟",
                "التصحيحات على البيانات الاصطناعية تبقى في جلسة المتصفح فقط، ولا تُرسل إلى خادم. يوضّح مصدر البيانات داخل اللوحة متى تكون المراجعات محفوظة.",
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-final-cta">
          <span className="lp-orbit" aria-hidden="true" />
          <BrandMark />
          <h2>
            جمهورك يتحدث.
            <br />
            <em>ابدأ بالإنصات.</em>
          </h2>
          <p>خذ جولة في تجربة عربية تجعل التعليقات أقرب إلى الفهم.</p>
          <Link className="lp-button" to="/dashboard">
            استكشف اللوحة <span aria-hidden="true">←</span>
          </Link>
          <span className="lp-caption">
            المثال هنا توضيحي · ربط القناة للحسابات المخوّلة
          </span>
        </section>
      </main>
      <footer className="lp-footer">
        <div>
          <Link className="lp-brand" to="/">
            <BrandMark /> مشاعر الجمهور.
          </Link>
          <p>رؤية أوضح لما وراء تعليقات يوتيوب.</p>
        </div>
        <nav aria-label="روابط التذييل">
          <Link to="/dashboard">اللوحة</Link>
          <Link to="/account">الحساب</Link>
          <a href="#questions">أسئلة شائعة</a>
        </nav>
        <div className="lp-footer-bottom">
          <span>مشاعر الجمهور · نسخة أولية</span>
          <span>معاينة خاصة — ليست إطلاقًا عامًا</span>
        </div>
      </footer>
    </div>
  );
}
