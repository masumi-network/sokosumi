import "server-only";

import { cookies } from "next/headers";

import prisma from "@/lib/db/repositories/prisma";
import { UTM_COOKIE_NAME, UTMData, utmDataSchema } from "@/lib/utils/utm";
import { Prisma, UTMAttribution } from "@/prisma/generated/client";

export class UTMService {
  constructor(protected client: Prisma.TransactionClient = prisma) {}

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
