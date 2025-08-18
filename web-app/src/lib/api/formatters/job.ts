import "server-only";

import { JobResponse, jobResponseSchema } from "@/lib/api/schemas";
import { dateToISO } from "@/lib/api/utils";
import { convertCentsToCredits } from "@/lib/db";
import { JobWithStatus } from "@/lib/db/types";

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
    agentJobStatus: job.agentJobStatus,
    onChainStatus: job.onChainStatus,
    input: job.input,
    output: job.output,
    startedAt: dateToISO(job.startedAt),
    completedAt: job.completedAt ? dateToISO(job.completedAt) : null,
    resultSubmittedAt: job.resultSubmittedAt
      ? dateToISO(job.resultSubmittedAt)
      : null,
    isDemo: job.isDemo,
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
  };

  // Validate the formatted response
  return jobResponseSchema.parse(formatted);
}
