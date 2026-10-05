/**
 * Contracts for the Admin System & Third-Party Services Health Dashboard.
 *
 * Exposes health indicators, latency, quota/rate-limits, and diagnostic
 * metadata for all internal and third-party services.
 */
import { z } from "zod";
import { timestamp } from "./primitives";

export const ServiceStatusSchema = z.enum([
  "healthy",
  "degraded",
  "down",
  "unconfigured",
  // No live telemetry reaches this service yet. Said as such rather than as
  // "healthy": a dashboard that shows green for what it never measured is the
  // one that reassures at the wrong moment.
  "not_monitored",
]);

export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const ServiceCategorySchema = z.enum([
  "infrastructure",
  "ai_engine",
  "data_ingestion",
  "billing",
]);

export type ServiceCategory = z.infer<typeof ServiceCategorySchema>;

export const ServiceHealthItemSchema = z
  .object({
    id: z.string(),
    name_ar: z.string(),
    name_en: z.string(),
    category: ServiceCategorySchema,
    status: ServiceStatusSchema,
    latency_ms: z.number().int().nonnegative().nullable(),
    quota_used: z.number().nonnegative().nullable(),
    quota_total: z.number().positive().nullable(),
    quota_unit: z.string().nullable(),
    details: z.string(),
    last_checked_at: timestamp,
    endpoint: z.string().nullable(),
    error_code: z.string().nullable(),
    remediation: z.string().nullable(),
  })
  .strict();

export type ServiceHealthItem = z.infer<typeof ServiceHealthItemSchema>;

export const ServicesSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    healthy: z.number().int().nonnegative(),
    degraded: z.number().int().nonnegative(),
    down: z.number().int().nonnegative(),
    unconfigured: z.number().int().nonnegative(),
    not_monitored: z.number().int().nonnegative(),
    avg_latency_ms: z.number().nonnegative().nullable(),
  })
  .strict();

export type ServicesSummary = z.infer<typeof ServicesSummarySchema>;

export const ServicesHealthReportSchema = z
  .object({
    overall_status: ServiceStatusSchema,
    checked_at: timestamp,
    summary: ServicesSummarySchema,
    services: z.array(ServiceHealthItemSchema),
  })
  .strict();

export type ServicesHealthReport = z.infer<typeof ServicesHealthReportSchema>;
