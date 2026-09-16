import { describe, expect, it } from "vitest";
import { ar } from "./strings/ar";
import { formatUsd, pricingRows } from "./pricing";
import type { Plan } from "@sentiment/contracts";

const plan = (over: Partial<Plan>): Plan => ({
  key: "creator",
  segment: "individual",
  title_ar: "منشئ",
  title_en: "Creator",
  price_monthly_cents: 1200,
  price_yearly_cents: 12000,
  self_serve: true,
  provider_prices: {},
  limits: {
    analysis_units: 10000,
    topic_units: 4000,
    insight_reports: 10,
    channels: 1,
    members: 1,
    workspaces: 1,
    live_interval_minutes: 1440,
  },
  ...over,
});

describe("pricing rows", () => {
  it("formats dollars without cents", () => {
    expect(formatUsd(1200)).toBe("$12");
    expect(formatUsd(24900)).toBe("$249");
    expect(formatUsd(0)).toBe("$0");
  });
  it("yearly shows the monthly equivalent and the billed total", () => {
    const [row] = pricingRows([plan({})], "individual", "year", "ar", ar);
    expect(row.price).toBe("$10");
    expect(row.yearlyNote).toBe(ar.pricingPerMonthBilledYearly("$120"));
  });
  it("the anchor is creator_plus for individuals and agency for business", () => {
    const rows = pricingRows(
      [
        plan({}),
        plan({ key: "creator_plus" }),
        plan({ key: "agency", segment: "business" }),
        plan({ key: "media", segment: "business", self_serve: false }),
      ],
      "business",
      "month",
      "ar",
      ar,
    );
    expect(rows.map((r) => [r.key, r.anchor])).toEqual([
      ["agency", true],
      ["media", false],
    ]);
  });
  it("a plan that is not self-serve asks to contact; free starts free", () => {
    const rows = pricingRows(
      [
        plan({ key: "free", price_monthly_cents: 0 }),
        plan({ key: "media", self_serve: false }),
      ],
      "individual",
      "month",
      "ar",
      ar,
    );
    expect(rows[0].cta.kind).toBe("free");
    expect(rows[1].cta.kind).toBe("contact");
  });
  it("a self-serve paid plan checks out; the current plan wins over checkout and free", () => {
    const [checkoutRow] = pricingRows(
      [plan({})],
      "individual",
      "month",
      "ar",
      ar,
    );
    expect(checkoutRow.cta).toEqual({
      kind: "checkout",
      label: ar.pricingCtaStart,
    });

    const [currentRow] = pricingRows(
      [plan({})],
      "individual",
      "month",
      "ar",
      ar,
      "creator",
    );
    expect(currentRow.cta).toEqual({
      kind: "current",
      label: ar.pricingCtaCurrent,
    });

    const [currentOverFreeRow] = pricingRows(
      [plan({ key: "free", price_monthly_cents: 0 })],
      "individual",
      "month",
      "ar",
      ar,
      "free",
    );
    expect(currentOverFreeRow.cta.kind).toBe("current");
  });
  it("-1 reads as unlimited", () => {
    const [row] = pricingRows(
      [plan({ limits: { ...plan({}).limits, channels: -1 } })],
      "individual",
      "month",
      "ar",
      ar,
    );
    expect(
      row.limits.find((l) => l.label === ar.pricingLimitChannels)!.value,
    ).toBe(ar.pricingUnlimited);
  });
});
