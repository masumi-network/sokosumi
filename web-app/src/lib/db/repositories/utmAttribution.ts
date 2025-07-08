import "server-only";

import { UTMParams } from "@/lib/utils/utm";
import { Prisma, UTMAttribution } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function createUTMAttribution(
  userId: string,
  utmParams: UTMParams,
  capturedAt: Date,
  convertedAt: Date,
  tx: Prisma.TransactionClient = prisma,
): Promise<UTMAttribution | null> {
  return await tx.uTMAttribution.create({
    data: {
      userId,
      utmSource: utmParams.utmSource,
      utmMedium: utmParams.utmMedium,
      utmCampaign: utmParams.utmCampaign,
      utmTerm: utmParams.utmTerm,
      utmContent: utmParams.utmContent,
      capturedAt,
      convertedAt,
    },
  });
}
