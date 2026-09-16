/**
 * The pricing page: the catalogue, read signed out, as cards.
 *
 * Prices are never written here. In live mode they come from
 * `plan_catalogue()`, which is granted to `anon` for exactly this page; in
 * fixture mode from `fixtureCatalogue`, the same six rows the migration
 * inserts (`planCatalogue.ts`). `pricingRows` turns a row into the words a
 * card says — which one is the anchor, what the button does — so this file
 * only lays them out.
 *
 * Outside the app shell on purpose: a reader deciding whether to sign in has
 * no workspace, no rail and no session, and the page must read the same to
 * them as to an owner comparing the next step up.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import "./pricing.css";
import { PublicShell } from "./public/PublicShell";
import { usePlanCatalogue } from "./planCatalogue";
import { type Locale } from "./locale";
import { useStrings } from "./strings";
import { publicPath } from "./publicPaths";
import { pricingSeo } from "./seo";
import { PageHead, usePublicLocale } from "./PageHead";
import { contactEmail, pricingRows, type PricingRow } from "./pricing";
import { useSession, useWorkspaces } from "./session";
import { usePlanUsage } from "./planUsage";
import { openCheckout, openPortal } from "./paddle";

type Segment = "individual" | "business";
const SEGMENTS: readonly Segment[] = ["individual", "business"];

/** `locale` comes from the route — `/pricing` is Arabic, `/en/pricing`
 *  English — not from the stored preference; see `publicPaths.ts`. */
export function Pricing({ locale }: { locale: Locale }) {
  const S = useStrings(locale);
  const navigate = useNavigate();
  const { session } = useSession();
  // Signed in, the checkout needs the workspace the reader chose — the same
  // choice the rail card and the account's plan panel follow — and the plan
  // it already holds marks its own card as current; if that plan is paid
  // through Paddle, the other paid cards open Paddle's portal rather than a
  // second checkout. Signed out, both hooks answer nothing and cost nothing.
  const { workspaces } = useWorkspaces(session);
  const { workspaceId, plan } = usePlanUsage(session, workspaces);
  const [segment, setSegment] = useState<Segment>("individual");
  const [yearly, setYearly] = useState(false);
  // What a card has to say after its button was pressed, by plan key. Only
  // the checkout path can fail, and it fails as a sentence under the card.
  const [notice, setNotice] = useState<Record<string, string>>({});
  // Shared with the admin page's select: one key, one read.
  const catalogue = usePlanCatalogue();
  const interval = yearly ? "year" : "month";
  const rows = pricingRows(
    catalogue.data ?? [],
    segment,
    interval,
    locale,
    S,
    plan.data?.plan_key ?? null,
    plan.data?.provider ?? null,
  );
  usePublicLocale(locale);
  const home = publicPath("home", locale);

  const act = (row: PricingRow) => {
    if (row.cta.kind === "contact") {
      window.location.href = `mailto:${contactEmail}?subject=${encodeURIComponent(row.title)}`;
      return;
    }
    // Starting free, starting a paid plan signed out, and starting one with
    // no workspace chosen all begin at the account: the first because that
    // is where a plan is activated, the others because a checkout needs to
    // know who is buying and which workspace is bought for.
    if (row.cta.kind === "free" || !session || !workspaceId) {
      void navigate("/account");
      return;
    }
    setNotice((n) => ({ ...n, [row.key]: "" }));
    // A workspace already on Paddle changes plan in Paddle's portal, the
    // same door as the plan panel's "manage", with the same two refusals.
    const call =
      row.cta.kind === "manage"
        ? openPortal(session, workspaceId)
        : openCheckout({ planKey: row.key, interval, session, workspaceId });
    call.catch((error: unknown) =>
      setNotice((n) => ({
        ...n,
        [row.key]:
          (error as Error)?.message === "no_paddle_customer"
            ? S.portalNoCustomer
            : S.checkoutUnavailable,
      })),
    );
  };

  return (
    <PublicShell
      locale={locale}
      page="pricing"
      pageClassName="pricing-page"
      mainId="pricing-content"
      mainClassName="pricing"
      links={[
        { href: home, label: S.backHome, kind: "route" },
        { href: `${home}#questions`, label: S.lpNavFaq, kind: "anchor" },
        { href: "/dashboard", label: S.lpFooterDashboard, kind: "route" },
      ]}
    >
      {/* The offers in the structured data are the rows the cards show —
          nothing priced here that the catalogue did not say. */}
      <PageHead seo={pricingSeo(locale, S, catalogue.data ?? [])} />
      <div className="lp-section-heading">
        <h1>{S.pricingHeading}</h1>
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
            <p className="pricing-price" data-quoted={!r.perLabel || undefined}>
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
    </PublicShell>
  );
}
