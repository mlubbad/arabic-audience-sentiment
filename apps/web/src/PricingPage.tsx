/**
 * The pricing page: the catalogue, read signed out, as cards.
 *
 * Prices are never written here. In live mode they come from
 * `plan_catalogue()`, which is granted to `anon` for exactly this page; in
 * fixture mode from `fixtureCatalogue`, the same six rows the migration
 * inserts. `pricingRows` turns a row into the words a card says — which one
 * is the anchor, what the button does — so this file only lays them out.
 *
 * Outside the app shell on purpose: a reader deciding whether to sign in has
 * no workspace, no rail and no session, and the page must read the same to
 * them as to an owner comparing the next step up.
 */
import { useLayoutEffect, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { PlanCatalogueSchema } from "@sentiment/contracts";
import "./landing.css";
import { BrandMark } from "./BrandMark";
import { LanguageSwitch } from "./LanguageSwitch";
import { supabase } from "./supabase";
import { configuredMode, fixtureCatalogue } from "./data";
import { applyToDocument, direction, useLocale } from "./locale";
import { useStrings } from "./strings";
import { contactEmail, pricingRows, type PricingRow } from "./pricing";
import { useSession } from "./session";
import { openCheckout } from "./paddle";

type Segment = "individual" | "business";
const SEGMENTS: readonly Segment[] = ["individual", "business"];

async function readCatalogue() {
  if (configuredMode !== "live" || !supabase) return fixtureCatalogue;
  const { data, error } = await supabase.rpc("plan_catalogue");
  // The reason is not surfaced: a PostgREST error can carry the request URL.
  if (error) throw new Error("catalogue_unavailable");
  return PlanCatalogueSchema.parse(data);
}

export function Pricing() {
  const S = useStrings();
  const locale = useLocale();
  const navigate = useNavigate();
  const { session } = useSession();
  const [segment, setSegment] = useState<Segment>("individual");
  const [yearly, setYearly] = useState(false);
  // What a card has to say after its button was pressed, by plan key. Only
  // the checkout path can fail, and it fails as a sentence under the card.
  const [notice, setNotice] = useState<Record<string, string>>({});
  const catalogue = useQuery({
    queryKey: ["catalogue"],
    queryFn: readCatalogue,
  });
  const interval = yearly ? "year" : "month";
  const rows = pricingRows(catalogue.data ?? [], segment, interval, locale, S);
  useLayoutEffect(() => {
    applyToDocument(locale);
  }, [locale]);
  useEffect(() => {
    const previous = document.title;
    document.title = `${S.pricingTitle} — ${S.brand}`;
    return () => {
      document.title = previous;
    };
  }, [S]);

  const act = (row: PricingRow) => {
    if (row.cta.kind === "contact") {
      window.location.href = `mailto:${contactEmail}?subject=${encodeURIComponent(row.title)}`;
      return;
    }
    // Starting free and starting a paid plan signed out both begin at the
    // account: the first because that is where a plan is activated, the
    // second because a checkout needs to know who is buying.
    if (row.cta.kind === "free" || !session) {
      void navigate("/account");
      return;
    }
    setNotice((n) => ({ ...n, [row.key]: "" }));
    openCheckout({ planKey: row.key, interval, session }).catch(() =>
      setNotice((n) => ({ ...n, [row.key]: S.checkoutUnavailable })),
    );
  };

  return (
    <div className="landing pricing-page" dir={direction(locale)}>
      <a className="lp-skip" href="#pricing-content">
        {S.skipToContent}
      </a>
      {/* The same band as the landing: the language switch is white ink and
          needs the dark plane it was drawn for. */}
      <div className="lp-announcement">
        {S.announcementLead} <span>{S.announcementTag}</span>
        <LanguageSwitch />
      </div>
      <header className="lp-header">
        <Link className="lp-brand" to="/" aria-label={S.brandHomeLabel}>
          <BrandMark /> {S.brand}
          <span className="lp-brand-dot">.</span>
        </Link>
        <nav className="lp-nav" aria-label={S.lpNavLabel}>
          <Link to="/">{S.backHome}</Link>
          <Link to="/dashboard">{S.lpFooterDashboard}</Link>
        </nav>
        <Link className="lp-header-cta" to="/account">
          {S.lpOpenAccount} <span aria-hidden="true">{S.arrowUpForward}</span>
        </Link>
      </header>
      <main id="pricing-content" className="pricing">
        <div className="lp-section-heading">
          <h1>{S.pricingTitle}</h1>
          <p className="pricing-lead">{S.pricingLead}</p>
        </div>
        <div className="pricing-controls">
          <div
            role="tablist"
            className="pricing-segments"
            aria-label={S.pricingTitle}
          >
            {SEGMENTS.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={segment === s}
                onClick={() => setSegment(s)}
              >
                {s === "individual"
                  ? S.pricingSegmentIndividual
                  : S.pricingSegmentBusiness}
              </button>
            ))}
          </div>
          <div className="pricing-interval">
            <span aria-hidden="true">{S.pricingMonthly}</span>
            <button
              type="button"
              role="switch"
              aria-checked={yearly}
              aria-label={S.pricingYearly}
              onClick={() => setYearly((v) => !v)}
            >
              <span className="pricing-knob" aria-hidden="true" />
            </button>
            <span aria-hidden="true">{S.pricingYearly}</span>
          </div>
        </div>
        {catalogue.isPending && (
          <p className="pricing-state" role="status">
            {S.pricingLoading}
          </p>
        )}
        {catalogue.isError && (
          <p className="pricing-state" role="alert">
            {S.pricingUnavailable}
          </p>
        )}
        <section className="pricing-cards" aria-live="polite">
          {rows.map((r) => (
            <article
              key={r.key}
              className="pricing-card"
              data-anchor={r.anchor || undefined}
              aria-labelledby={`plan-${r.key}`}
            >
              {r.anchor && (
                <span className="pricing-anchor">{S.pricingMostChosen}</span>
              )}
              <h2 id={`plan-${r.key}`}>{r.title}</h2>
              <p
                className="pricing-price"
                data-quoted={!r.perLabel || undefined}
              >
                <strong>{r.price}</strong>
                {r.perLabel && <span>{r.perLabel}</span>}
              </p>
              {r.yearlyNote && (
                <p className="pricing-yearly-note">{r.yearlyNote}</p>
              )}
              <ul className="pricing-limits">
                {r.limits.map((l) => (
                  <li key={l.label}>
                    <span>{l.label}</span>
                    {l.value && <strong>{l.value}</strong>}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="pricing-cta"
                data-kind={r.cta.kind}
                disabled={r.cta.kind === "current"}
                onClick={() => act(r)}
              >
                {r.cta.label}
              </button>
              {notice[r.key] && (
                <p className="pricing-notice" role="status">
                  {notice[r.key]}
                </p>
              )}
            </article>
          ))}
        </section>
        <section className="pricing-faq" aria-labelledby="pricing-faq-title">
          <h2 id="pricing-faq-title">{S.pricingFaqTitle}</h2>
          <p>{S.pricingFaqNoDouble}</p>
          <p>{S.pricingFaqHardStop}</p>
          <p>{S.pricingFaqPack}</p>
          <p>{S.pricingFaqTax}</p>
        </section>
      </main>
    </div>
  );
}
