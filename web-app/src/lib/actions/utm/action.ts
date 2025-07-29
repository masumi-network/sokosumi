"use server";

import { cookies } from "next/headers";

import { getEnvSecrets } from "@/config/env.secrets";
import { ActionError, CommonErrorCode } from "@/lib/actions/types";
import { Err, Ok, Result } from "@/lib/ts-res";
import {
  UTM_COOKIE_MAX_AGE,
  UTM_COOKIE_NAME,
  UTMData,
  utmDataSchema,
} from "@/lib/utils/utm";

/**
 * Store UTM data in cookie
 */
export async function setUTMCookieIfNotExists(
  utmData: UTMData,
): Promise<Result<UTMData, ActionError>> {
  try {
    const cookieStore = await cookies();

    let oldUTMData: UTMData | null = null;
    const utmCookie = cookieStore.get(UTM_COOKIE_NAME)?.value;
    if (utmCookie) {
      try {
        const parsed = utmDataSchema.parse(JSON.parse(utmCookie));
        if (
          new Date(parsed.capturedAt) >
          new Date(Date.now() - UTM_COOKIE_MAX_AGE * 1000)
        ) {
          oldUTMData = parsed;
        }
      } catch (error) {
        console.error("Failed to parse UTM cookie", error);
      }
    }

    if (oldUTMData) {
      return Ok(oldUTMData);
    }

    const cookieValue = JSON.stringify(utmData);
    cookieStore.set(UTM_COOKIE_NAME, cookieValue, {
      maxAge: UTM_COOKIE_MAX_AGE,
      domain: getEnvSecrets().COOKIE_DOMAIN,
      httpOnly: false,
      secure: getEnvSecrets().NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });

    return Ok(utmData);
  } catch (error) {
    console.error("Failed to set UTM cookie", error);
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    });
  }
}

export async function removeUTMCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(UTM_COOKIE_NAME);
}
