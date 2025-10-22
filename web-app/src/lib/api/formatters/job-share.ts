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
    accessType: jobShare.accessType,
    allowSearchIndexing: jobShare.allowSearchIndexing,
    recipientOrganization: jobShare.recipientOrganization
      ? {
          id: jobShare.recipientOrganization.id,
          name: jobShare.recipientOrganization.name,
          slug: jobShare.recipientOrganization.slug,
          logo: jobShare.recipientOrganization.logo,
        }
      : null,
  };

  // Validate the formatted response
  return jobShareResponseSchema.parse(formatted);
}
