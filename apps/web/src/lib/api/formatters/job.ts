import "server-only";

import { AgentJobStatus, JobWithStatus } from "@sokosumi/database";
import { getLatestJobEvent } from "@sokosumi/database/helpers";

import { JobResponse, jobResponseSchema } from "@/lib/api/schemas";
import { dateToISO } from "@/lib/api/utils";
import { convertCentsToCredits } from "@/lib/helpers/credit";

import { formatJobShareResponse } from "./job-share";

/**
 * Extracts input from job events.
 * Returns the first event's input that is not null.
 */
function getJobInput(job: JobWithStatus): string {
  // TODO: Rethink this, as this is being used for the SOKOSUMI API, but we should return inputs in the events array.
  const inputEvent = job.events.find((event) => event.input !== null);
  return inputEvent?.input ?? "{}";
}

/**
 * Extracts result from job events.
 * Returns the completed event's result, or null if not found.
 */
function getJobResult(job: JobWithStatus): string | null {
  const completedEvent = job.events.find(
    (event) => event.status === AgentJobStatus.COMPLETED,
  );
  return completedEvent?.result ?? null;
}

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
    agentJobStatus: getLatestJobEvent(job)?.status,
    onChainStatus: job.purchase?.onChainStatus ?? null,
    input: getJobInput(job),
    result: getJobResult(job),
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
