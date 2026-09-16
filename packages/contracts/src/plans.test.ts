import { describe, expect, it } from "vitest";
import { PlanCatalogueSchema } from "./index";

describe("plan catalogue contract", () => {
  it("parses a catalogue row", () => {
    const p = PlanCatalogueSchema.parse([
      {
        key: "creator",
        segment: "individual",
        title_ar: "منشئ",
        title_en: "Creator",
        price_monthly_cents: 1200,
        price_yearly_cents: 12000,
        self_serve: true,
        limits: {
          analysis_units: 10000,
          topic_units: 4000,
          insight_reports: 10,
          channels: 1,
          members: 1,
          workspaces: 1,
          live_interval_minutes: 1440,
        },
        provider_prices: {},
      },
    ]);
    expect(p[0].key).toBe("creator");
  });

  it("-1 in a limit means no ceiling", () => {
    const p = PlanCatalogueSchema.parse([
      {
        key: "owner",
        segment: "internal",
        title_ar: "المالك",
        title_en: "Owner",
        price_monthly_cents: 0,
        price_yearly_cents: 0,
        self_serve: false,
        limits: {
          analysis_units: -1,
          topic_units: -1,
          insight_reports: 0,
          channels: -1,
          members: -1,
          workspaces: -1,
          live_interval_minutes: 60,
        },
        provider_prices: {},
      },
    ]);
    expect(p[0].limits.channels).toBe(-1);
  });
});
