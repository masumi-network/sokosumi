import z from "zod";

export interface UTMParams {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
}

export interface UTMData extends UTMParams {
  referrer?: string;
  landingPage?: string;
  capturedAt: string; // ISO Date string
}

export const utmDataSchema = z.object({
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmTerm: z.string().optional(),
  utmContent: z.string().optional(),
  referrer: z.string().optional(),
  landingPage: z.string().optional(),
  capturedAt: z.string().datetime(),
});

export const UTM_COOKIE_NAME = "sokosumi_utm";
export const UTM_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Extract UTM parameters from URL search params
 */
export function extractUTMParams(
  searchParams: URLSearchParams,
): UTMParams | null {
  let hasUTMParams = false;
  const utmParams: UTMParams = {
    utmSource: searchParams.get("utm_source") ?? undefined,
    utmMedium: searchParams.get("utm_medium") ?? undefined,
    utmCampaign: searchParams.get("utm_campaign") ?? undefined,
    utmTerm: searchParams.get("utm_term") ?? undefined,
    utmContent: searchParams.get("utm_content") ?? undefined,
  };

  for (const value of Object.values(utmParams)) {
    if (value) {
      hasUTMParams = true;
    }
  }

  return hasUTMParams ? utmParams : null;
}
