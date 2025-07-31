import "server-only";

import { utmAttributionRepository } from "@/lib/db/repositories/utmAttribution.repository";
import { UTMAttribution } from "@/prisma/generated/client";

/**
 * Service for handling UTM attribution logic.
 * Provides methods to create UTM attribution records based on UTM data stored in cookies.
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
      const utmData = await utmAttributionRepository.getUTMDataFromCookie();
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
      await utmAttributionRepository.removeUTMCookie();
    }
  },
};
