import "server-only";

import { ActionError, CommonErrorCode } from "@/lib/actions/types";
import { utmAttributionRepository } from "@/lib/db/repositories/utmAttribution.repository";
import { Err, Ok, Result } from "@/lib/ts-res";
import { UTM_COOKIE_MAX_AGE, UTMData } from "@/lib/utils/utm";
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

  setUTMCookieIfNotExists: async (
    utmData: UTMData,
  ): Promise<Result<UTMData, ActionError>> => {
    try {
      let oldUTMData: UTMData | null = null;
      try {
        const utmDataFromCookie =
          await utmAttributionRepository.getUTMDataFromCookie();
        if (utmDataFromCookie) {
          if (
            new Date(utmDataFromCookie.capturedAt) >
            new Date(Date.now() - UTM_COOKIE_MAX_AGE * 1000)
          ) {
            oldUTMData = utmDataFromCookie;
          }
        }
      } catch (error) {
        console.error("Failed to parse UTM cookie", error);
      }

      if (oldUTMData) {
        return Ok(oldUTMData);
      }

      await utmAttributionRepository.setUTMCookie(utmData);
      return Ok(utmData);
    } catch (error) {
      console.error("Failed to set UTM cookie", error);
      return Err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "Internal server error",
      });
    }
  },
};
