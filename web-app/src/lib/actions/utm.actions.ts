"use server";

import { ActionError, CommonErrorCode } from "@/lib/actions/types";
import { utmService } from "@/lib/services/utm.service";
import { Err, Ok, Result } from "@/lib/ts-res";
import { UTM_COOKIE_MAX_AGE, UTMData } from "@/lib/utils/utm";

/**
 * UTM Actions for server-side UTM cookie management.
 */
export const utmActions = {
  /**
   * Sets the UTM data in a cookie if a valid UTM cookie does not already exist.
   *
   * - Checks for an existing UTM cookie.
   * - If a valid (not expired) UTM cookie exists, returns its value.
   * - Otherwise, sets a new UTM cookie with the provided data.
   *
   * @param utmData - The UTMData object to store in the cookie if not already present.
   * @returns A Result containing the UTMData stored in the cookie, or an ActionError on failure.
   */
  async setUTMCookieIfNotExists(
    utmData: UTMData,
  ): Promise<Result<UTMData, ActionError>> {
    try {
      try {
        // Attempt to retrieve existing UTM cookie
        const utmCookie = await utmService.getUTMDataFromCookie();
        // If a valid, non-expired UTM cookie exists, return it
        if (
          utmCookie &&
          new Date(utmCookie.capturedAt) >
            new Date(Date.now() - UTM_COOKIE_MAX_AGE * 1000)
        ) {
          return Ok(utmCookie);
        }
      } catch (error) {
        // Log parsing errors but continue to set a new cookie
        console.error("Failed to parse UTM cookie", error);
      }

      // Set a new UTM cookie with the provided data
      await utmService.setUTMDataInCookie(utmData);

      return Ok(utmData);
    } catch (error) {
      // Log and return an internal server error if setting the cookie fails
      console.error("Failed to set UTM cookie", error);
      return Err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "Internal server error",
      });
    }
  },
};
