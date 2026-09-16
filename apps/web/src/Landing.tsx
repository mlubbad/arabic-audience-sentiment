import { useState } from "react";
import { Link } from "react-router";
import "./landing.css";
import { SENTIMENT } from "./chartTheme";
import { BrandMark } from "./BrandMark";
import { direction, otherLocale, type Locale } from "./locale";
import { useStrings } from "./strings";
import { LanguageSwitch } from "./LanguageSwitch";
import { LegalLinks } from "./LegalLinks";
import { publicPath } from "./publicPaths";
import { homeSeo } from "./seo";
import { PageHead, usePublicLocale } from "./PageHead";

/* The demo's four comments. Their labels come from the shared strings rather
   than being written again here: a visitor who learns a word on this page
   meets the same word inside the product, and there is no second place for it
   to drift. The comments themselves stay Arabic in every interface language —
   they are the data the product reads, not something it says — and carry
   their own `lang` so a left-to-right page still shapes them right. */
const examples = [
  { text: "شرح واضح، استفدت من الأمثلة كثيرًا 👏", label: "positive" },
  { text: "المحتوى جميل، لكن المقدمة طويلة قليلًا", label: "mixed" },
  { text: "أتمنى توضيح المصادر في الحلقة القادمة", label: "neutral" },
  { text: "الصوت غير واضح في هذا المقطع", label: "negative" },
] as const;

/* And the colours, for the same reason and one more.
   This page had its own map — positive a purple #8470e9, negative a pink
   #eb819a — so a visitor learned one colour language here and met a different
   one the moment they reached the dashboard, where positive is teal and
   negative is red. Two languages for one meaning, on the surface that forms
   the first impression.
   The landing's own pair separated better under colourblind vision (ΔE 23.4
   against the dashboard's 9.6, both clearing the ≥8 gate), but every one of
   its four marks sat below 3:1 on white — 2.58, 2.60, 1.83 — so they were the
   weaker set where it counts, and the dashboard's are measured against that
   floor in `palette.test.ts`. */
const colors: Record<(typeof examples)[number]["label"], string> = {
  positive: SENTIMENT.positive,
  negative: SENTIMENT.negative,
  neutral: SENTIMENT.neutral,
  mixed: SENTIMENT.mixed,
};
/* Arabic-Indic digits on the Arabic page — the one surface that uses them,
   as a landing does — and Western digits in English. */
const numerals = {
  ar: new Intl.NumberFormat("ar", { numberingSystem: "arab" }),
  en: new Intl.NumberFormat("en"),
};

/** `locale` comes from the route — `/` is Arabic and `/en` is English — not
 *  from the stored preference; see `publicPaths.ts`. */
export function Landing({ locale }: { locale: Locale }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState("all");
  const [audience, setAudience] = useState<"creator" | "agency">("creator");
  const S = useStrings(locale);
  const labels = S.labels;
  const numeral = numerals[locale];
  const audiences = {
    creator: {
      eyebrow: S.lpForYou,
      title: S.lpCreatorTitle,
      text: S.lpCreatorText,
      tags: S.lpCreatorTags,
      space: S.lpYourChannelSpace,
    },
    agency: {
      eyebrow: S.lpForTeam,
      title: S.lpAgencyTitle,
      text: S.lpAgencyText,
      tags: S.lpAgencyTags,
      space: S.lpClientSpace,
    },
  };
  const shown = examples.filter(
    (c) => selected === "all" || c.label === selected,
  );
  const shares = examples.map((c) => ({
    ...c,
    percent:
      (shown.filter((row) => row.label === c.label).length / shown.length) *
      100,
  }));
  const pct = (v: number) =>
    `${numeral.format(v)}${locale === "ar" ? "٪" : "%"}`;
  // The language on the document and in the store, for as long as this
  // page is mounted — the shell does the same for itself.
  usePublicLocale(locale);
  const home = publicPath("home", locale);
  const pricing = publicPath("pricing", locale);
  return (
    <div className="landing" dir={direction(locale)}>
      <PageHead seo={homeSeo(locale, S)} />
      <a className="lp-skip" href="#landing-content">
        {S.skipToContent}
      </a>
      <div className="lp-announcement">
        {S.announcementLead} <span>{S.announcementTag}</span>
        <LanguageSwitch
          locale={locale}
          to={publicPath("home", otherLocale(locale))}
        />
      </div>
      <header className="lp-header">
        <Link className="lp-brand" to={home} aria-label={S.brandHomeLabel}>
          <BrandMark /> {S.brand}
          <span className="lp-brand-dot">.</span>
        </Link>
        <button
          className="lp-menu"
          aria-label={S.lpMenuLabel}
          aria-expanded={menuOpen}
          aria-controls="landing-nav"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? S.menuClose : S.menuOpen}
        </button>
        <nav
          id="landing-nav"
          className={menuOpen ? "lp-nav is-open" : "lp-nav"}
          aria-label={S.lpNavLabel}
        >
          <a href="#why" onClick={() => setMenuOpen(false)}>
            {S.lpNavWhy}
          </a>
          <a href="#experience" onClick={() => setMenuOpen(false)}>
            {S.lpNavExperience}
          </a>
          <a href="#questions" onClick={() => setMenuOpen(false)}>
            {S.lpNavFaq}
          </a>
          {/* The page's own title is the link's text: one sentence, one key. */}
          <Link to={pricing}>{S.pricingTitle}</Link>
        </nav>
        <Link className="lp-header-cta" to="/account">
          {S.lpOpenAccount} <span aria-hidden="true">{S.arrowUpForward}</span>
        </Link>
      </header>
      <main id="landing-content" className="lp-main">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <span className="lp-youtube" aria-hidden="true">
                ▶
              </span>{" "}
              {S.lpHeroEyebrow}
            </span>
            <h1 id="hero-title">
              {S.lpHeroLine1}
              <br />
              {S.lpHeroLine2}
              <br />
              <em>{S.lpHeroLine3}</em>
            </h1>
            <p>{S.lpHeroLead}</p>
            <div className="lp-actions">
              <Link className="lp-button" to="/dashboard">
                {S.lpExploreDashboard}{" "}
                <span aria-hidden="true">{S.arrowForward}</span>
              </Link>
              <a className="lp-text-link" href="#experience">
                {S.lpSeeHow}{" "}
                <span aria-hidden="true">{S.arrowDownForward}</span>
              </a>
            </div>
            <p className="lp-caption">{S.lpHeroCaption}</p>
          </div>
          <div className="lp-hero-art">
            <div className="lp-art-halo" />
            {/* WebP, 29 kB, where the PNG it was encoded from was 1.19 MB —
                the largest thing on the page by forty times, on the request
                the browser is told to make first. Same pixels, same box. The
                alt is the picture's own sentence: it is the one image a
                search engine can read off this page, and a share card's. */}
            <img
              src="/landing/audience-growth-original.webp"
              width="1536"
              height="1024"
              alt={S.lpHeroAlt}
              fetchPriority="high"
            />
            <div className="lp-floating lp-floating-top">
              <span className="lp-spark">✦</span>
              <div>
                <b>{S.lpFloatTopStrong}</b>
                <span>{S.lpFloatTop}</span>
              </div>
            </div>
            <div className="lp-floating lp-floating-bottom">
              <span className="lp-comment-icon">”</span>
              <div>
                <b>{S.lpFloatBottomStrong}</b>
                <span>
                  <i className="lp-dot mixed" /> {S.lpFloatBottom}
                </span>
              </div>
            </div>
          </div>
          <div
            className="lp-hero-word"
            aria-hidden="true"
            data-word={S.lpHeroWord}
          />
        </section>
        <div className="lp-value-strip">
          <span>{S.lpValue1}</span>
          <span>{S.lpValue2}</span>
          <span>{S.lpValue3}</span>
          <span>{S.lpValue4}</span>
        </div>

        <section className="lp-statement" id="why" aria-labelledby="why-title">
          <span className="lp-orbit lp-orbit-one" aria-hidden="true" />
          <span className="lp-orbit lp-orbit-two" aria-hidden="true" />
          <span className="lp-eyebrow">{S.lpWhyEyebrow}</span>
          <h2 id="why-title">
            {S.lpWhyLine1}
            <br />
            <em>{S.lpWhyLine2}</em>
          </h2>
          <p>{S.lpWhyLead}</p>
          <a className="lp-button lp-button-light" href="#experience">
            {S.lpZoomIn} <span aria-hidden="true">↓</span>
          </a>
        </section>

        <section
          className="lp-section lp-experience"
          id="experience"
          aria-labelledby="experience-title"
        >
          <div className="lp-section-heading">
            <span className="lp-eyebrow">{S.lpExperienceEyebrow}</span>
            <h2 id="experience-title">
              {S.lpExperienceLine1}
              <br />
              <em>{S.lpExperienceLine2}</em>
            </h2>
            <p>{S.lpExperienceLead}</p>
          </div>
          <div className="lp-demo-frame">
            <div className="lp-demo-top">
              <span>
                <BrandMark /> {S.lpDemoBrand}
              </span>
              <span className="lp-demo-label">{S.lpDemoLabel}</span>
            </div>
            <div className="lp-demo-content">
              <div className="lp-demo-chart">
                <span className="lp-mini-label">{S.lpDemoChartLabel}</span>
                <div
                  className="lp-donut"
                  role="img"
                  style={
                    selected === "all"
                      ? undefined
                      : { background: colors[shown[0].label] }
                  }
                  aria-label={shares
                    .map((c) => `${labels[c.label]}: ${pct(c.percent)}`)
                    .join(S.listSeparator)}
                >
                  <div>
                    <strong>{numeral.format(shown.length)}</strong>
                    <span>{S.lpDemoInSelection}</span>
                  </div>
                </div>
                <div className="lp-legend">
                  {shares.map((c) => (
                    <span key={c.label}>
                      <i className={`lp-dot ${c.label}`} />
                      {labels[c.label]} <b>{pct(c.percent)}</b>
                    </span>
                  ))}
                </div>
              </div>
              <div className="lp-demo-comments">
                <div
                  className="lp-demo-filters"
                  role="group"
                  aria-label={S.lpDemoFilterLabel}
                >
                  <button
                    aria-pressed={selected === "all"}
                    onClick={() => setSelected("all")}
                  >
                    {S.all}
                  </button>
                  {examples.map((c) => (
                    <button
                      key={c.label}
                      aria-pressed={selected === c.label}
                      onClick={() => setSelected(c.label)}
                    >
                      {labels[c.label]}
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
                        {labels[c.label][0]}
                      </span>
                      <p lang="ar" dir="rtl">
                        {c.text}
                      </p>
                      <span className={`lp-sentiment ${c.label}`}>
                        {labels[c.label]}
                      </span>
                    </div>
                  ))}
                </div>
                <Link className="lp-demo-link" to="/dashboard">
                  {S.lpDemoLink}{" "}
                  <span aria-hidden="true">{S.arrowForward}</span>
                </Link>
              </div>
            </div>
          </div>
          <div className="lp-benefits">
            <div>
              <span>{S.lpBenefit1Tag}</span>
              <h3>{S.lpBenefit1Title}</h3>
              <p>{S.lpBenefit1}</p>
            </div>
            <div>
              <span>{S.lpBenefit2Tag}</span>
              <h3>{S.lpBenefit2Title}</h3>
              <p>{S.lpBenefit2}</p>
            </div>
            <div>
              <span>{S.lpBenefit3Tag}</span>
              <h3>{S.lpBenefit3Title}</h3>
              <p>{S.lpBenefit3}</p>
            </div>
          </div>
        </section>

        <section className="lp-audience" aria-labelledby="audience-title">
          <div className="lp-section-heading">
            <span className="lp-eyebrow">{S.lpAudienceEyebrow}</span>
            <h2 id="audience-title">
              {S.lpAudienceLine1}
              <br />
              {S.lpAudienceLine2}
            </h2>
          </div>
          <div
            className="lp-audience-tabs"
            role="group"
            aria-label={S.lpAudienceTabsLabel}
          >
            <button
              aria-pressed={audience === "creator"}
              onClick={() => setAudience("creator")}
            >
              {S.lpCreators}
            </button>
            <button
              aria-pressed={audience === "agency"}
              onClick={() => setAudience("agency")}
            >
              {S.lpAgencies}
            </button>
          </div>
          <div className="lp-audience-panel" aria-live="polite">
            <div className="lp-audience-copy">
              <span className="lp-eyebrow">{audiences[audience].eyebrow}</span>
              <h3>{audiences[audience].title}</h3>
              <p>{audiences[audience].text}</p>
              <div className="lp-tags">
                {audiences[audience].tags.map((tag) => (
                  <span key={tag}>✓ {tag}</span>
                ))}
              </div>
              <Link className="lp-text-link" to="/dashboard">
                {S.lpExploreWork}{" "}
                <span aria-hidden="true">{S.arrowForward}</span>
              </Link>
            </div>
            <div className="lp-workspace-art" aria-hidden="true">
              <div className="lp-workspace-window">
                <div className="lp-window-dots" aria-hidden="true">
                  ● ● ●
                </div>
                <span className="lp-mini-label">
                  {audiences[audience].space}
                </span>
                <div className="lp-video-row">
                  <span>▶</span>
                  <div>
                    <b>{S.lpVideoRow}</b>
                    <i />
                  </div>
                </div>
                <div className="lp-mini-bars">
                  {[42, 76, 58, 92, 67, 84, 100].map((h, i) => (
                    <i key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="lp-window-note">
                  {S.lpWindowNote} <span>✓</span>
                </div>
              </div>
              <span className="lp-art-caption">{S.lpArtCaption}</span>
            </div>
          </div>
        </section>

        <section className="lp-section lp-trust" aria-labelledby="trust-title">
          <div>
            <span className="lp-eyebrow">{S.lpTrustEyebrow}</span>
            <h2 id="trust-title">
              {S.lpTrustLine1}
              <br />
              {S.lpTrustLine2} <em>{S.lpTrustLine3}</em>
            </h2>
            <p>{S.lpTrustLead}</p>
          </div>
          <div className="lp-trust-items">
            <div>
              <span>◉</span>
              <h3>{S.lpTrust1Title}</h3>
              <p>{S.lpTrust1}</p>
            </div>
            <div>
              <span>↻</span>
              <h3>{S.lpTrust2Title}</h3>
              <p>{S.lpTrust2}</p>
            </div>
            <div>
              <span>{S.arrowUpForward}</span>
              <h3>{S.lpTrust3Title}</h3>
              <p>{S.lpTrust3}</p>
            </div>
          </div>
        </section>

        <section
          className="lp-section lp-faq"
          id="questions"
          aria-labelledby="faq-title"
        >
          <div>
            <span className="lp-eyebrow">{S.lpFaqEyebrow}</span>
            <h2 id="faq-title">{S.lpFaqTitle}</h2>
            <p>{S.lpFaqLead}</p>
          </div>
          <div className="lp-faq-list">
            {/* Question, answer, question, answer: a flat list in the strings,
                read in pairs, so a translation cannot carry a question without
                its answer or an answer under the wrong question. */}
            {Array.from({ length: S.lpFaq.length / 2 }, (_, i) => [
              S.lpFaq[i * 2],
              S.lpFaq[i * 2 + 1],
            ]).map(([q, a]) => (
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
            {S.lpFinalLine1}
            <br />
            <em>{S.lpFinalLine2}</em>
          </h2>
          <p>{S.lpFinalLead}</p>
          <Link className="lp-button" to="/dashboard">
            {S.lpExploreDashboard}{" "}
            <span aria-hidden="true">{S.arrowForward}</span>
          </Link>
          <span className="lp-caption">{S.lpFinalCaption}</span>
        </section>
      </main>
      <footer className="lp-footer">
        <div>
          <Link className="lp-brand" to={home}>
            <BrandMark /> {S.brand}.
          </Link>
          <p>{S.lpFooterTagline}</p>
        </div>
        <nav aria-label={S.lpFooterNavLabel}>
          <Link to={pricing}>{S.pricingTitle}</Link>
          <Link to="/dashboard">{S.lpFooterDashboard}</Link>
          <Link to="/account">{S.lpFooterAccount}</Link>
          <a href="#questions">{S.lpNavFaq}</a>
        </nav>
        {/* Where a reviewer at Google or Paddle looks for them, and where a
            visitor expects them: the foot of the page, by their own titles. */}
        <LegalLinks className="lp-legal" locale={locale} />
        <div className="lp-footer-bottom">
          <span>{S.lpFooterVersion}</span>
          <span>{S.lpFooterPreview}</span>
        </div>
      </footer>
    </div>
  );
}
