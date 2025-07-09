import "server-only";

import { UTMData } from "@/lib/utils/utm";
import { Prisma, UTMAttribution } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function createUTMAttribution(
  userId: string,
  utmData: UTMData,
  convertedAt: Date,
  tx: Prisma.TransactionClient = prisma,
): Promise<UTMAttribution | null> {
  return await tx.uTMAttribution.create({
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
