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
import "./legal.css";
import { PublicShell } from "./public/PublicShell";
import { useLocale, type Locale } from "./locale";
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
    <PublicShell
      locale={locale}
      page={key}
      pageClassName="legal-page"
      mainId="legal-content"
      mainClassName="legal"
      links={[
        { href: home, label: S.backHome, kind: "route" },
        {
          href: publicPath("pricing", locale),
          label: S.pricingTitle,
          kind: "route",
        },
      ]}
    >
      <PageHead seo={legalSeo(key, locale, S)} />
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
    </PublicShell>
  );
}
