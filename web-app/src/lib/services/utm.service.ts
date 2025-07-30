import "server-only";

import { utmAttributionRepository } from "@/lib/db/repositories/utmAttribution.repository";
import { UTMAttribution } from "@/prisma/generated/client";

export const utmService = {
  createUTMAttributionIfCookieExists: async (
    userId: string,
  ): Promise<UTMAttribution | null> => {
    try {
      const utmData = await utmAttributionRepository.getUTMDataFromCookie();
      if (utmData) {
        return await utmAttributionRepository.create(
          userId,
          utmData,
          new Date(),
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
