import "server-only";

import { JobShare } from "@sokosumi/database";

import { JobShareResponse, jobShareResponseSchema } from "@/lib/api/schemas";
import { dateToISO } from "@/lib/api/utils";
import { getJobShareUrl } from "@/lib/helpers/job-share";

/**
 * Formats job data for API response
 */
export function formatJobShareResponse(share: JobShare): JobShareResponse {
  return jobShareResponseSchema.parse({
    id: share.id,
    jobId: share.jobId,
    organizationId: share.organizationId,
    url: getJobShareUrl(share),
    allowSearchIndexing: share.allowSearchIndexing,
    createdAt: dateToISO(share.createdAt),
    updatedAt: dateToISO(share.updatedAt),
  });
}
