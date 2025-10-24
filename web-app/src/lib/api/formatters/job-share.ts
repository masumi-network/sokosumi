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
    id: jobShare.id,
    user: jobShare.user,
    url: getJobShareUrl(jobShare),
    recipientOrganization: jobShare.recipientOrganization,
    allowSearchIndexing: jobShare.allowSearchIndexing,
    createdAt: dateToISO(jobShare.createdAt),
    updatedAt: dateToISO(jobShare.updatedAt),
  };

  // Validate the formatted response
  return jobShareResponseSchema.parse(formatted);
}
