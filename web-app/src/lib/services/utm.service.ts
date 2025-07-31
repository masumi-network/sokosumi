import "server-only";

import { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { cookies } from "next/headers";

import { utmAttributionRepository } from "@/lib/db/repositories/utmAttribution.repository";
import { UTM_COOKIE_NAME, UTMData, utmDataSchema } from "@/lib/utils/utm";
import { UTMAttribution } from "@/prisma/generated/client";

/**
 * Service for handling UTM attribution logic and cookie management.
 * Provides methods to create UTM attribution records and manage UTM data in cookies.
 */
export const utmService = {
  /**
   * Handles the conversion of UTM data for a given user.
   *
   * This method:
   * - Retrieves UTM data from the user's cookies.
   * - If valid UTM data is found, creates a UTM attribution record in the database for the specified user.
   * - Removes the UTM cookie after processing, regardless of success or failure.
   *
   * @param userId - The unique identifier of the user for whom to create the UTM attribution.
   * @returns A promise that resolves to the created UTMAttribution object if successful, or null otherwise.
   */
  async handleUTMConversion(userId: string): Promise<UTMAttribution | null> {
    const cookieStore = await cookies();
    try {
      const utmData = getUTMDataFromCookie(cookieStore);
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
};

/**
 * Retrieves and parses UTM data from the provided cookie store.
 *
 * - Attempts to read the UTM attribution cookie by its configured name.
 * - If the cookie exists, parses its JSON value and validates it against the UTM data schema.
 * - Returns the parsed and validated UTMData object if successful, or null if the cookie is missing or invalid.
 *
 * @param cookieStore - The cookie store (typically from Next.js `cookies()` API) to read the UTM cookie from.
 * @returns The parsed UTMData object if available and valid, otherwise null.
 */
function getUTMDataFromCookie(
  cookieStore: ReadonlyRequestCookies,
): UTMData | null {
  const utmCookie = cookieStore.get(UTM_COOKIE_NAME)?.value;
  if (!utmCookie) return null;
  try {
    return utmDataSchema.parse(JSON.parse(utmCookie));
  } catch (error) {
    console.error("Failed to parse UTM cookie", error);
    return null;
  }
}
