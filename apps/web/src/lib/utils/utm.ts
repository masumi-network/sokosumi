import * as z from "zod";

// Re-export types from database package
export type { UTMData, UTMParams } from "@sokosumi/database";

export const utmDataSchema = z.object({
  utm_source: z.string().min(1).max(255),
  utm_medium: z.string().max(255).optional(),
  utm_campaign: z.string().max(255).optional(),
  utm_term: z.string().max(255).optional(),
  utm_content: z.string().max(255).optional(),
  referrer: z.string().max(255).optional(),
  landingPage: z.string().max(255).optional(),
  capturedAt: z.iso.datetime(),
});

export const UTM_COOKIE_NAME = "sokosumi_utm";
export const UTM_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
