import "server-only";

import { cookies } from "next/headers";

import prisma from "@/lib/db/repositories/prisma";
import { UTM_COOKIE_NAME, UTMData, utmDataSchema } from "@/lib/utils/utm";
import { Prisma, UTMAttribution } from "@/prisma/generated/client";

/**
 * Service for handling UTM (Urchin Tracking Module) attribution data.
 *
 * This service provides methods to create UTM attribution records in the database
 * and to retrieve UTM data from cookies. It is typically used to track the source
 * and context of user signups or conversions for analytics and marketing attribution.
 */
export class UTMService {
  /**
   * Constructs a new UTMService instance.
   *
   * @param client - Prisma transaction client for transactional operations.
   */
  constructor(protected client: Prisma.TransactionClient) {}

  /**
   * Creates a UTM attribution record in the database for a given user.
   *
   * @param userId - The ID of the user to associate with the UTM attribution.
   * @param utmData - The UTM data object containing source, medium, campaign, etc.
   * @param convertedAt - The date and time when the conversion occurred.
   * @returns A promise that resolves to the created UTMAttribution record, or null if creation fails.
   */
  async createUTMAttribution(
    userId: string,
    utmData: UTMData,
    convertedAt: Date,
  ): Promise<UTMAttribution | null> {
    return await this.client.uTMAttribution.create({
      data: {
        user: {
          connect: {
            id: userId,
          },
        },
        utmSource: utmData.utmSource,
        utmMedium: utmData.utmMedium,
        utmCampaign: utmData.utmCampaign,
        utmTerm: utmData.utmTerm,
        utmContent: utmData.utmContent,
        referrer: utmData.referrer,
        landingPage: utmData.landingPage,
        capturedAt: new Date(utmData.capturedAt),
        convertedAt,
      },
    });
  }

  /**
   * Retrieves and parses UTM data from the UTM cookie, if present.
   *
   * @returns A promise that resolves to the parsed UTMData object if the cookie exists and is valid,
   *          or null if the cookie is missing or invalid.
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
  }
}

/**
 * Singleton instance of UTMService for managing UTM attribution logic.
 *
 * Use this exported instance to interact with UTM-related operations,
 * such as creating UTM attributions and retrieving UTM data from cookies.
 *
 * Example:
 *   import { utmService } from "@/lib/services/utm.service";
 *   const utmData = await utmService.getUTMDataFromCookie();
 */
export const utmService = createUTMService();

/**
 * Factory function to create a new instance of UTMService.
 *
 * @param client - Optional Prisma transaction client for transactional operations.
 *                 Defaults to the main Prisma client if not provided.
 * @returns An instance of UTMService for managing UTM attribution logic.
 *
 * Example:
 *   const utmService = createUTMService();
 *   // or with a transaction client:
 *   const utmService = createUTMService(tx);
 */
export function createUTMService(
  client: Prisma.TransactionClient = prisma,
): UTMService {
  return new UTMService(client);
}
