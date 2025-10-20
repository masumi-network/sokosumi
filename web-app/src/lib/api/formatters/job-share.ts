import "server-only";

import { JobShareResponse, jobShareResponseSchema } from "@/lib/api/schemas";
import { dateToISO } from "@/lib/api/utils";
import { getJobShareUrl, JobShareWithRelations } from "@/lib/db";

/**
 * Formats job data for API response
 */
export function formatJobShareResponse(
  jobShare: JobShareWithRelations,
): JobShareResponse {
  const formatted = {
    createdAt: dateToISO(jobShare.createdAt),
    updatedAt: dateToISO(jobShare.updatedAt),
    url: getJobShareUrl(jobShare),
    creator: jobShare.creator,
  };

  // Validate the formatted response
  return jobShareResponseSchema.parse(formatted);
}
