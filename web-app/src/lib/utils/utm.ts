import "server-only";

import { cookies, headers } from "next/headers";
import z from "zod";

import { getEnvSecrets } from "@/config/env.secrets";

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

const utmDataSchema = z.object({
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmTerm: z.string().optional(),
  utmContent: z.string().optional(),
  referrer: z.string().optional(),
  landingPage: z.string().optional(),
  capturedAt: z.string().datetime(),
});

const UTM_COOKIE_NAME = "sokosumi_utm";
const UTM_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Extract UTM parameters from URL search params
 */
function extractUTMParams(searchParams: URLSearchParams): UTMParams | null {
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

/**
 * Store UTM data in cookie
 */
async function setUTMCookie(utmData: UTMData): Promise<void> {
  const cookieStore = await cookies();
  const cookieValue = JSON.stringify(utmData);

  cookieStore.set(UTM_COOKIE_NAME, cookieValue, {
    maxAge: UTM_COOKIE_MAX_AGE,
    httpOnly: false,
    secure: getEnvSecrets().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

/**
 * Get UTM data from cookie
 */
export async function getUTMCookie(): Promise<UTMData | null> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(UTM_COOKIE_NAME)?.value;

  if (!cookieValue) return null;

  try {
    const utmData = utmDataSchema.safeParse(JSON.parse(cookieValue));
    if (!utmData.success) {
      console.error("Failed to parse UTM cookie:", utmData.error);
      return null;
    }
    return utmData.data;
  } catch (error) {
    console.error("Failed to parse UTM cookie as JSON:", error);
    return null;
  }
}

/**
 * Process UTM parameters in server components using headers
 */
export async function processUTMParams(): Promise<UTMData | null> {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname");
  const searchParamsString = headersList.get("x-search-params");
  const referer = headersList.get("referer");

  if (!pathname || !searchParamsString) {
    return null;
  }

  const searchParams = new URLSearchParams(searchParamsString);
  const utmParams = extractUTMParams(searchParams);

  if (!utmParams) {
    return null;
  }

  // check if utm params are already in the cookie
  const utmCookie = await getUTMCookie();
  if (
    utmCookie &&
    new Date(utmCookie.capturedAt) >
      new Date(Date.now() - UTM_COOKIE_MAX_AGE * 1000)
  ) {
    return utmCookie;
  }

  const utmData: UTMData = {
    ...utmParams,
    referrer: referer ?? undefined,
    landingPage: pathname,
    capturedAt: new Date().toISOString(),
  };

  // Store in cookie
  await setUTMCookie(utmData);

  return utmData;
}
