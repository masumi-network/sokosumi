import "server-only";

import {
  JobPublicShareResponse,
  jobPublicShareResponseSchema,
} from "@/lib/api/schemas";
import { dateToISO } from "@/lib/api/utils";
import { getJobPublicShareUrl } from "@/lib/db";
import { JobShare } from "@/prisma/generated/client";

/**
 * Formats job data for API response
 */
export function formatJobPublicShareResponse(
  publicShare: JobShare,
): JobPublicShareResponse {
  return jobPublicShareResponseSchema.parse({
    id: publicShare.id,
    jobId: publicShare.jobId,
    url: getJobPublicShareUrl(publicShare),
    allowSearchIndexing: publicShare.allowSearchIndexing,
    createdAt: dateToISO(publicShare.createdAt),
    updatedAt: dateToISO(publicShare.updatedAt),
  });
}
