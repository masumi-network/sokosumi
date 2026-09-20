import type { Prisma, UTMAttribution } from "../generated/prisma/client.js";
import type { UTMData } from "../types/utm.js";

export const utmAttributionRepository = {
  /**
   * Idempotent: `userId` is unique, so a retried conversion refreshes the row
   * instead of throwing.
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
