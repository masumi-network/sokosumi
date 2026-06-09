import type { Prisma, UTMAttribution } from "../generated/prisma/client.js";
import type { UTMData } from "../types/utm.js";

/**
 * Repository for UTM attribution-related database operations.
 * Provides methods to create and manage UTM attribution records in the database.
 */
export const utmAttributionRepository = {
  /**
   * Records a UTM attribution for a user, idempotently.
   *
   * `userId` is unique on the table, so this upserts: the first conversion
   * creates the row, while a repeated conversion (e.g. a retried sign-up flow)
   * refreshes the attribution instead of throwing a unique-constraint error.
   *
   * @param userId - The unique identifier of the user to associate with the UTM attribution.
   * @param utmData - The UTM data to store in the attribution record.
   * @param tx - The Prisma transaction client to use.
   * @returns A promise that resolves to the upserted UTMAttribution object, or null if the write fails.
   */
  async createUTMAttribution(
    userId: string,
    utmData: UTMData,
    tx: Prisma.TransactionClient,
  ): Promise<UTMAttribution | null> {
    const attributionData = {
      utmSource: utmData.utm_source,
      utmMedium: utmData.utm_medium,
      utmCampaign: utmData.utm_campaign,
      utmTerm: utmData.utm_term,
      utmContent: utmData.utm_content,
      referrer: utmData.referrer,
      landingPage: utmData.landingPage,
      capturedAt: new Date(utmData.capturedAt),
      convertedAt: new Date(),
    };

    return await tx.uTMAttribution.upsert({
      where: { userId },
      create: {
        user: {
          connect: {
            id: userId,
          },
        },
        ...attributionData,
      },
      update: attributionData,
    });
  },
};
