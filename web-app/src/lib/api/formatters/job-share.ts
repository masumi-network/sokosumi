import "server-only";

import {
  JobPublicShareResponse,
  jobPublicShareResponseSchema,
} from "@/lib/api/schemas";
import { dateToISO } from "@/lib/api/utils";
import { getJobPublicShareUrl } from "@/lib/db";
import { JobPublicShare } from "@/prisma/generated/client";

/**
 * Formats job data for API response
 */
export function formatJobPublicShareResponse(
  publicShare: JobPublicShare,
): JobPublicShareResponse {
  return jobPublicShareResponseSchema.parse({
    id: publicShare.id,
    userId: publicShare.userId,
    url: getJobPublicShareUrl(publicShare),
    allowSearchIndexing: publicShare.allowSearchIndexing,
    createdAt: dateToISO(publicShare.createdAt),
    updatedAt: dateToISO(publicShare.updatedAt),
  });
}
