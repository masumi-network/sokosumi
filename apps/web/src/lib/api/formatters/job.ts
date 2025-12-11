import "server-only";

import { JobWithStatus } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

import { JobResponse, jobResponseSchema } from "@/lib/api/schemas";
import { dateToISO } from "@/lib/api/utils";

import { formatJobShareResponse } from "./job-share";

/**
 * Formats job data for API response
 */
export function formatJobResponse(job: JobWithStatus): JobResponse {
  const formatted = {
    id: job.id,
    createdAt: dateToISO(job.createdAt),
    updatedAt: dateToISO(job.updatedAt),
    name: job.name,
    status: job.status,
    agentId: job.agentId,
    userId: job.userId,
    organizationId: job.organizationId,
    agentJobId: job.agentJobId,
    agentJobStatus: job.statuses.at(0)?.status ?? null,
    onChainStatus: job.purchase?.onChainStatus ?? null,
    input: job.input,
    result: job.result,
    startedAt: dateToISO(job.createdAt),
    completedAt: job.completedAt ? dateToISO(job.completedAt) : null,
    jobType: job.jobType,
    price: job.creditTransaction
      ? {
          credits: Math.abs(
            convertCentsToCredits(job.creditTransaction.amount),
          ),
          includedFee: Math.abs(
            convertCentsToCredits(job.creditTransaction.includedFee),
          ),
        }
      : null,
    refund: job.refundedCreditTransaction
      ? {
          credits: Math.abs(
            convertCentsToCredits(job.refundedCreditTransaction.amount),
          ),
          includedFee: Math.abs(
            convertCentsToCredits(job.refundedCreditTransaction.includedFee),
          ),
        }
      : null,
    jobStatusSettled: job.jobStatusSettled,
    share: job.share ? formatJobShareResponse(job.share) : null,
  };

  // Validate the formatted response
  return jobResponseSchema.parse(formatted);
}
