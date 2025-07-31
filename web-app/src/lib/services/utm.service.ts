import "server-only";

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
    try {
      const utmData = await this.getUTMDataFromCookie();
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
      await this.removeUTMCookie();
    }
  },

  /**
   * Retrieves UTM data from the user's cookies, if available.
   *
   * @returns A promise that resolves to the parsed UTMData object if the cookie exists and is valid, or null otherwise.
   */
  async getUTMDataFromCookie(): Promise<UTMData | null> {
    const cookieStore = await cookies();
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
   * Stores the provided UTM data in a cookie for attribution tracking.
   *
   * Serializes the UTMData object and sets it as a cookie in the user's browser.
   * The cookie is configured with appropriate security and domain settings.
   *
   * @param utmData - The UTMData object to store in the cookie.
   * @returns A promise that resolves when the cookie has been set.
   */
  async setUTMDataInCookie(utmData: UTMData): Promise<void> {
    const cookieValue = JSON.stringify(utmData);
    const cookieStore = await cookies();
    cookieStore.set(UTM_COOKIE_NAME, cookieValue, {
      maxAge: UTM_COOKIE_MAX_AGE,
      domain: getEnvSecrets().COOKIE_DOMAIN,
      httpOnly: false,
      secure: getEnvSecrets().NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  },

  /**
   * Removes the UTM data cookie from the user's browser.
   *
   * @returns A promise that resolves when the cookie has been deleted.
   */
  async removeUTMCookie(): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(UTM_COOKIE_NAME);
  },
};
