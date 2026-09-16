/**
 * A legal document, read signed out.
 *
 * Beside the landing and the pricing page rather than inside the shell, for
 * the same reason as pricing: a reader deciding whether to grant a Google
 * scope, or a reviewer at Google or Paddle checking the link on the landing
 * footer, has no session and must see the whole text without one.
 *
 * Which document is a prop, not a parameter read from the URL: the routes
 * table in main.tsx is the only place that maps an address to a document,
 * and `LEGAL_PATHS` is what every link reads, so the two cannot disagree.
 */
import { Link } from "react-router";
import "./landing.css";
import { BrandMark } from "./BrandMark";
import { LanguageSwitch } from "./LanguageSwitch";
import { LegalLinks } from "./LegalLinks";
import { direction, otherLocale, useLocale, type Locale } from "./locale";
import { useStrings } from "./strings";
import { inline, legalFor, type LegalKey } from "./legal";
import { publicPath } from "./publicPaths";
import { legalSeo } from "./seo";
import { PageHead, usePublicLocale } from "./PageHead";

function Paragraph({ text }: { text: string }) {
  return (
    <p>
      {inline(text).map((run, i) =>
        typeof run === "string" ? (
          run
        ) : (
          <a key={i} href={run.href} target="_blank" rel="noopener noreferrer">
            {run.label}
          </a>
        ),
      )}
    </p>
  );
}

export function LegalPage({
  doc: key,
  locale: given,
}: {
  doc: LegalKey;
  /** Named by the route (`/terms` is Arabic, `/en/terms` English); the
   *  stored preference only when rendered without one, as a test does. */
  locale?: Locale;
}) {
  const stored = useLocale();
  const locale = given ?? stored;
  const S = useStrings(locale);
  const doc = legalFor(locale)[key];
  // The date in the reader's language and digits — the landing uses
  // Arabic-Indic digits on the Arabic page, and so does this one.
  const updated = new Intl.DateTimeFormat(
    locale === "ar" ? "ar-u-nu-arab" : "en",
    { dateStyle: "long", timeZone: "UTC" },
  ).format(new Date(doc.updated));
  usePublicLocale(locale);
  const home = publicPath("home", locale);
  return (
    <div className="landing legal-page" dir={direction(locale)}>
      <PageHead seo={legalSeo(key, locale, S)} />
      <a className="lp-skip" href="#legal-content">
        {S.skipToContent}
      </a>
      <div className="lp-announcement">
        {S.announcementLead} <span>{S.announcementTag}</span>
        <LanguageSwitch
          locale={locale}
          to={publicPath(key, otherLocale(locale))}
        />
      </div>
      <header className="lp-header">
        <Link className="lp-brand" to={home} aria-label={S.brandHomeLabel}>
          <BrandMark /> {S.brand}
          <span className="lp-brand-dot">.</span>
        </Link>
        <nav className="lp-nav" aria-label={S.lpNavLabel}>
          <Link to={home}>{S.backHome}</Link>
          <Link to={publicPath("pricing", locale)}>{S.pricingTitle}</Link>
        </nav>
        <Link className="lp-header-cta" to="/account">
          {S.lpOpenAccount} <span aria-hidden="true">{S.arrowUpForward}</span>
        </Link>
      </header>
      <main id="legal-content" className="legal">
        <article aria-labelledby="legal-title">
          {/* A div, not a <header>: style.css lays every header out as a
              flex bar with a rule under it, and this is a title block. */}
          <div className="legal-head">
            <h1 id="legal-title">{doc.title}</h1>
            <p className="legal-updated">
              {/* Formatted by ICU on the server and in the browser, whose
                  versions may differ by a joiner; the date is data the
                  page carries in `dateTime`, so a mismatch is not worth a
                  re-render. */}
              {S.legalUpdated}:{" "}
              <time dateTime={doc.updated} suppressHydrationWarning>
                {updated}
              </time>
            </p>
            <p className="legal-lead">{doc.lead}</p>
          </div>
          <nav className="legal-contents" aria-label={S.legalContents}>
            <p>{S.legalContents}</p>
            <ol>
              {doc.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.heading}</a>
                </li>
              ))}
            </ol>
          </nav>
          {doc.sections.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`}>
              <h2 id={`${s.id}-title`}>{s.heading}</h2>
              {s.paragraphs.map((p) => (
                <Paragraph key={p} text={p} />
              ))}
              {s.bullets && (
                <ul>
                  {s.bullets.map((b) => (
                    <li key={b}>
                      <Paragraph text={b} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </article>
      </main>
      <footer className="lp-footer">
        <div>
          <Link className="lp-brand" to={home}>
            <BrandMark /> {S.brand}.
          </Link>
          <p>{S.lpFooterTagline}</p>
        </div>
        <LegalLinks className="lp-legal" locale={locale} />
        <div className="lp-footer-bottom">
          <span>{S.lpFooterVersion}</span>
          <span>{S.lpFooterPreview}</span>
        </div>
      </footer>
    </div>
  );
}
