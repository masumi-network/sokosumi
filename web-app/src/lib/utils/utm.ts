import z from "zod";

export interface UTMParams {
  utm_source: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

export interface UTMData extends UTMParams {
  referrer?: string;
  landingPage?: string;
  capturedAt: string; // ISO Date string
}

export const utmDataSchema = z.object({
  utm_source: z.string().min(1).max(255),
  utm_medium: z.string().max(255).optional(),
  utm_campaign: z.string().max(255).optional(),
  utm_term: z.string().max(255).optional(),
  utm_content: z.string().max(255).optional(),
  referrer: z.string().max(255).optional(),
  landingPage: z.string().max(255).optional(),
  capturedAt: z.string().datetime(),
});

export const UTM_COOKIE_NAME = "sokosumi_utm";
export const UTM_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
