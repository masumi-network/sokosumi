import "server-only";

import { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { cookies } from "next/headers";

import { getEnvSecrets } from "@/config/env.secrets";
import { utmAttributionRepository } from "@/lib/db/repositories/utmAttribution.repository";
import {
  UTM_COOKIE_MAX_AGE,
  UTM_COOKIE_NAME,
  UTMData,
  utmDataSchema,
} from "@/lib/utils/utm";
import { UTMAttribution } from "@/prisma/generated/client";

/**
 * Service for handling UTM attribution logic and cookie management.
 * Provides methods to create UTM attribution records and manage UTM data in cookies.
 */
export const utmService = {
  /**
   * Attempts to create a UTM attribution record for the specified user if UTM data is available in cookies.
   * - Retrieves UTM data from the user's cookies.
   * - If UTM data exists, creates a UTM attribution record in the database.
   * - Always removes the UTM cookie after attempting to create the record, regardless of success or failure.
   *
   * @param userId - The unique identifier of the user for whom to create the UTM attribution.
   * @returns A promise that resolves to the created UTMAttribution object if successful, or null otherwise.
   */
  async createUTMAttributionIfPossible(
    userId: string,
  ): Promise<UTMAttribution | null> {
    const cookieStore = await cookies();
    try {
      const utmData = this.getUTMDataFromCookie(cookieStore);
      if (utmData) {
        return await utmAttributionRepository.createUTMAttribution(
          userId,
          utmData,
        );
      }

      return null;
    } catch (error) {
      console.error("Failed to create utm attribution", error);
      return null;
    } finally {
      cookieStore.delete(UTM_COOKIE_NAME);
    }
  },

  /**
   * Retrieves UTM data from the user's cookies, if available.
   *
   * @returns A promise that resolves to the parsed UTMData object if the cookie exists and is valid, or null otherwise.
   */
  getUTMDataFromCookie(cookieStore: ReadonlyRequestCookies): UTMData | null {
    const utmCookie = cookieStore.get(UTM_COOKIE_NAME)?.value;
    if (!utmCookie) {
      return null;
    }
    try {
      return utmDataSchema.parse(JSON.parse(utmCookie));
    } catch (error) {
      console.error("Failed to parse UTM cookie", error);
      return null;
    }
  },

  /**
   * Sets the UTM data in a cookie for the user.
   *
   * - Serializes the provided UTMData object and stores it in a cookie.
   * - Configures the cookie with appropriate options for security and domain.
   * - Intended for use on the server to persist UTM attribution data for later retrieval.
   *
   * @param utmData - The UTMData object to store in the cookie.
   * @param cookieStore - The ReadonlyRequestCookies instance for managing cookies.
   */
  setUTMCookie(utmData: UTMData, cookieStore: ReadonlyRequestCookies): void {
    const cookieValue = JSON.stringify(utmData);
    cookieStore.set(UTM_COOKIE_NAME, cookieValue, {
      maxAge: UTM_COOKIE_MAX_AGE,
      domain: getEnvSecrets().COOKIE_DOMAIN,
      httpOnly: false,
      secure: getEnvSecrets().NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  },
};
