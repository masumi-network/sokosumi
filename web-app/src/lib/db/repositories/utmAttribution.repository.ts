import "server-only";

import { cookies } from "next/headers";

import { UTM_COOKIE_NAME, UTMData, utmDataSchema } from "@/lib/utils/utm";
import { Prisma, UTMAttribution } from "@/prisma/generated/client";

import prisma from "./prisma";

export const utmAttributionRepository = {
  create: async (
    userId: string,
    utmData: UTMData,
    convertedAt: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<UTMAttribution> => {
    const client = tx ?? prisma;
    return await client.uTMAttribution.create({
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
  },

  getUTMDataFromCookie: async (): Promise<UTMData | null> => {
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
  },

  removeUTMCookie: async (): Promise<void> => {
    const cookieStore = await cookies();
    cookieStore.delete(UTM_COOKIE_NAME);
  },
};
