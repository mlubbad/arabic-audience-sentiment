import { describe, expect, it } from "vitest";
import {
  HistoricalImportPayloadSchema,
  HistoricalImportResultSchema,
  HistoricalSyncRequestSchema,
  PlanLimitsSchema,
  PlanLimitsUpdateSchema,
  PlanSchema,
} from "./index";

describe("historical data and plan limits contracts", () => {
  it("validates plan limits with backfill units and historical days limit", () => {
    const parsed = PlanSchema.parse({
      key: "creator",
      segment: "individual",
      title_ar: "منشئ",
      title_en: "Creator",
      price_monthly_cents: 1200,
      price_yearly_cents: 12000,
      self_serve: true,
      allow_public_channels: false,
      backfill_units: 40000,
      historical_days_limit: 30,
      limits: {
        analysis_units: 10000,
        topic_units: 4000,
        insight_reports: 10,
        channels: 1,
        members: 1,
        workspaces: 1,
        live_interval_minutes: 1440,
      },
    });
    expect(parsed.backfill_units).toBe(40000);
    expect(parsed.historical_days_limit).toBe(30);
  });

  it("permits omitting historical limits on plans", () => {
    const parsed = PlanSchema.parse({
      key: "free",
      segment: "individual",
      title_ar: "مجاني",
      title_en: "Free",
      price_monthly_cents: 0,
      price_yearly_cents: 0,
      self_serve: true,
      limits: {
        analysis_units: 100,
        topic_units: 100,
        insight_reports: 1,
        channels: 0,
        members: 1,
        workspaces: 1,
        live_interval_minutes: 0,
      },
    });
    expect(parsed.backfill_units).toBeUndefined();
    expect(parsed.historical_days_limit).toBeUndefined();
  });

  it("validates historical import payload", () => {
    const payload = HistoricalImportPayloadSchema.parse({
      posts: [
        {
          external_video_id: "v123",
          title: "Test Post",
          kind: "channel_post",
        },
      ],
      comments: [
        {
          external_video_id: "v123",
          external_comment_id: "c456",
          text_raw: "تعليق رائع ومميز",
          author_name: "أحمد",
        },
      ],
    });
    expect(payload.posts).toHaveLength(1);
    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0].text_raw).toBe("تعليق رائع ومميز");
  });

  it("validates historical sync request", () => {
    const req = HistoricalSyncRequestSchema.parse({
      workspace_id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      channel_id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
      since_date: "2026-08-01T00:00:00Z",
      max_items: 250,
    });
    expect(req.max_items).toBe(250);
  });

  it("validates plan limits update payload", () => {
    const update = PlanLimitsUpdateSchema.parse({
      backfill_units: 50000,
      historical_days_limit: 60,
      allow_public_channels: true,
    });
    expect(update.backfill_units).toBe(50000);
    expect(update.historical_days_limit).toBe(60);
    expect(update.allow_public_channels).toBe(true);
  });

  it("validates plan limits and historical import result", () => {
    const limits = PlanLimitsSchema.parse({
      channels: 5,
      analysis_units: 100000,
      topic_units: 5000,
      insight_reports: 10,
      members: 5,
      workspaces: 2,
      live_interval_minutes: 30,
    });
    expect(limits.analysis_units).toBe(100000);

    const result = HistoricalImportResultSchema.parse({
      ok: true,
      posts_count: 5,
      comments_count: 20,
      backfill_units_used: 20,
      backfill_units_remaining: 49980,
    });
    expect(result.ok).toBe(true);
    expect(result.comments_count).toBe(20);
  });
});
