"use server";

import { cookies } from "next/headers";

import { getEnvSecrets } from "@/config/env.secrets";
import { UTM_COOKIE_MAX_AGE, UTM_COOKIE_NAME, UTMData } from "@/lib/utils/utm";

/**
 * Store UTM data in cookie
 */
export async function setUTMCookie(utmData: UTMData): Promise<void> {
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
