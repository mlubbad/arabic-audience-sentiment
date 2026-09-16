/**
 * What a pricing card says, decided away from the card so it can be tested
 * without rendering. Prices come from `plan_catalogue()`, never from here —
 * this module only turns a `Plan` row and the reader's segment/interval into
 * the words and CTA a card shows: which row is the anchor, whether the price
 * is per month or an equivalent billed yearly, whether the button starts a
 * checkout, asks to contact sales, starts free, marks the current plan, or —
 * for a workspace already paying through Paddle — sends the reader to
 * Paddle's portal to change plan there, so a second checkout never opens a
 * second subscription beside the first; and each limit rendered as a number
 * or as "unlimited" for a `-1` ceiling.
 */
import type { Plan } from "@sentiment/contracts";
import type { Strings } from "./strings";

export type PricingRow = {
  key: string;
  title: string;
  price: string;
  perLabel: string;
  yearlyNote: string | null;
  anchor: boolean;
  cta: {
    kind: "checkout" | "contact" | "free" | "current" | "manage";
    label: string;
  };
  limits: { label: string; value: string }[];
};

/** The row each segment steers a reader toward — priced above the cheapest
 *  self-serve plan, below the contact-us ones. */
const ANCHOR: Record<string, string> = {
  individual: "creator_plus",
  business: "agency",
};

/** Where a plan that is not self-serve sends a reader — one address, so the
 *  page and any card that asks to be contacted cannot name two. */
export const contactEmail = "info@sky-develop.net";

export const formatUsd = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export function pricingRows(
  catalogue: Plan[],
  segment: "individual" | "business",
  interval: "month" | "year",
  locale: "ar" | "en",
  S: Strings,
  currentKey: string | null = null,
  currentProvider: string | null = null,
): PricingRow[] {
  const n = (v: number) =>
    v === -1 ? S.pricingUnlimited : v.toLocaleString("en-US");
  return catalogue
    .filter((p) => p.segment === segment)
    .map((p) => {
      const monthly =
        interval === "year" ? p.price_yearly_cents / 12 : p.price_monthly_cents;
      // Not self-serve comes before free: enterprise carries no price in the
      // catalogue (0), and a zero that is not for sale is "ask", not "free".
      // A paid self-serve row for a workspace already on Paddle is managed,
      // not bought again: Paddle's portal changes the plan on the one
      // subscription, where a second checkout would open a second one.
      const paid = p.self_serve && p.price_monthly_cents > 0;
      const cta =
        p.key === currentKey
          ? { kind: "current" as const, label: S.pricingCtaCurrent }
          : !p.self_serve
            ? { kind: "contact" as const, label: S.pricingCtaContact }
            : paid && currentProvider === "paddle"
              ? { kind: "manage" as const, label: S.planManage }
              : p.price_monthly_cents === 0
                ? { kind: "free" as const, label: S.pricingCtaFree }
                : { kind: "checkout" as const, label: S.pricingCtaStart };
      const quoted = !p.self_serve && p.price_monthly_cents === 0;
      return {
        key: p.key,
        title: locale === "ar" ? p.title_ar : p.title_en,
        price: quoted ? S.pricingPriceQuoted : formatUsd(monthly),
        perLabel: quoted ? "" : S.pricingPerMonth,
        yearlyNote:
          !quoted && interval === "year" && p.price_yearly_cents > 0
            ? S.pricingPerMonthBilledYearly(formatUsd(p.price_yearly_cents))
            : null,
        anchor: ANCHOR[segment] === p.key,
        cta,
        limits: [
          { label: S.pricingLimitComments, value: n(p.limits.analysis_units) },
          { label: S.pricingLimitTopics, value: n(p.limits.topic_units) },
          { label: S.pricingLimitReports, value: n(p.limits.insight_reports) },
          { label: S.pricingLimitChannels, value: n(p.limits.channels) },
          { label: S.pricingLimitMembers, value: n(p.limits.members) },
          ...(segment === "business"
            ? [
                {
                  label: S.pricingLimitWorkspaces,
                  value: n(p.limits.workspaces),
                },
              ]
            : []),
          ...(p.limits.live_interval_minutes > 0
            ? [
                {
                  label: S.pricingLimitLive(
                    (p.limits.live_interval_minutes / 60).toLocaleString(
                      "en-US",
                    ),
                  ),
                  value: "",
                },
              ]
            : []),
        ],
      };
    });
}
