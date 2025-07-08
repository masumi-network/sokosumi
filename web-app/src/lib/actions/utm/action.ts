"use server";

import { cookies } from "next/headers";

import { getEnvSecrets } from "@/config/env.secrets";
import {
  UTM_COOKIE_MAX_AGE,
  UTM_COOKIE_NAME,
  UTMData,
  utmDataSchema,
} from "@/lib/utils/utm";

/**
 * Store UTM data in cookie
 */
export async function setUTMCookieIfNotExists(utmData: UTMData): Promise<void> {
  const cookieStore = await cookies();
  const cookieValue = JSON.stringify(utmData);

  let utmCookieExists: boolean = false;
  const utmCookie = cookieStore.get(UTM_COOKIE_NAME)?.value;
  if (utmCookie) {
    try {
      const parsed = utmDataSchema.parse(JSON.parse(utmCookie));
      if (
        new Date(parsed.capturedAt) >
        new Date(Date.now() - UTM_COOKIE_MAX_AGE * 1000)
      ) {
        utmCookieExists = true;
      }
    } catch (error) {
      console.error("Failed to parse UTM cookie", error);
    }
  }

  if (utmCookieExists) {
    return;
  }

  cookieStore.set(UTM_COOKIE_NAME, cookieValue, {
    maxAge: UTM_COOKIE_MAX_AGE,
    httpOnly: false,
    secure: getEnvSecrets().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}
