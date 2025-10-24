import "server-only";

import { JobShareResponse, jobShareResponseSchema } from "@/lib/api/schemas";
import { dateToISO } from "@/lib/api/utils";
import { getJobPublicShareUrl } from "@/lib/db";
import { JobPublicShare } from "@/prisma/generated/client";

/**
 * Formats job data for API response
 */
export function formatJobShareResponse(
  publicShare: JobPublicShare,
): JobShareResponse {
  const formatted = {
    id: publicShare.id,
    userId: publicShare.userId,
    url: getJobPublicShareUrl(publicShare),
    allowSearchIndexing: publicShare.allowSearchIndexing,
    createdAt: dateToISO(publicShare.createdAt),
    updatedAt: dateToISO(publicShare.updatedAt),
  };

  // Validate the formatted response
  return jobShareResponseSchema.parse(formatted);
}
