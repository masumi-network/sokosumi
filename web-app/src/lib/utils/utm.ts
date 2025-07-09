import z from "zod";

export interface UTMParams {
  utmSource: string;
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
  utmSource: z.string().min(1).max(255),
  utmMedium: z.string().max(255).optional(),
  utmCampaign: z.string().max(255).optional(),
  utmTerm: z.string().max(255).optional(),
  utmContent: z.string().max(255).optional(),
  referrer: z.string().max(255).optional(),
  landingPage: z.string().max(255).optional(),
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
  const utmParams: UTMParams = {
    utmSource: searchParams.get("utm_source") ?? "",
    utmMedium: searchParams.get("utm_medium") ?? undefined,
    utmCampaign: searchParams.get("utm_campaign") ?? undefined,
    utmTerm: searchParams.get("utm_term") ?? undefined,
    utmContent: searchParams.get("utm_content") ?? undefined,
  };

  // check if utmSource is not empty
  if (!!utmParams.utmSource) {
    return utmParams;
  }

  return null;
}
