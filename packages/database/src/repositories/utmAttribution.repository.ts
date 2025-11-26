import prisma from "../client.js";
import type { Prisma, UTMAttribution } from "../generated/prisma/client.js";
import type { UTMData } from "../types/utm.js";

/**
 * Repository for UTM attribution-related database operations.
 * Provides methods to create and manage UTM attribution records in the database.
 */
export const utmAttributionRepository = {
  /**
   * Creates a UTM attribution record for a user.
   *
   * @param userId - The unique identifier of the user to associate with the UTM attribution.
   * @param utmData - The UTM data to store in the attribution record.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the created UTMAttribution object, or null if creation fails.
   */
  async createUTMAttribution(
    userId: string,
    utmData: UTMData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<UTMAttribution | null> {
    return await tx.uTMAttribution.create({
      data: {
        user: {
          connect: {
            id: userId,
          },
        },
        utmSource: utmData.utm_source,
        utmMedium: utmData.utm_medium,
        utmCampaign: utmData.utm_campaign,
        utmTerm: utmData.utm_term,
        utmContent: utmData.utm_content,
        referrer: utmData.referrer,
        landingPage: utmData.landingPage,
        capturedAt: new Date(utmData.capturedAt),
        convertedAt: new Date(),
      },
    });
  },
};
