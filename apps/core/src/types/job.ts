import {
  type JobWithSokosumiStatus,
  type JobWithSummaryRelations,
} from "@sokosumi/database";
import {
  computeJobStatus,
  getCompletedAt,
  getCredits,
  getResult,
  getResultHash,
  isJobStatusSettled,
} from "@sokosumi/database/helpers";
import { getJobDetailsAgentOverrideFields } from "@/helpers/agent";
import {
  organizationSummaryFromLoadedRelation,
  userSummaryFromLoadedRelation,
} from "@/helpers/loaded-relation-summaries";
import { mapWorkspaceSummary } from "@/helpers/workspace";

function mapJobOwnerSummary(
  job: JobWithSummaryRelations | JobWithSokosumiStatus,
) {
  return userSummaryFromLoadedRelation(`Job ${job.id}`, job.ownerId, job.owner);
}

export function flattenJob(job: JobWithSummaryRelations) {
  const completedAt = getCompletedAt(job);
  const owner = mapJobOwnerSummary(job);

  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    agentId: job.agentId,
    ownerId: job.ownerId,
    owner,
    // Deprecated aliases — keep until clients migrate.
    userId: job.ownerId,
    user: owner,
    organizationId: job.organizationId,
    projectId: job.projectId ?? null,
    taskId: job.taskId,
    name: job.name,
    jobType: job.jobType,
    completedAt,
    onChainStatus: job.purchase?.onChainStatus ?? null,
    onChainTransactionHash: job.purchase?.onChainTransactionHash ?? null,
    result: getResult(job),
    resultHash: getResultHash(job),
    credits: getCredits(job),
    status: computeJobStatus(job),
    blockchainIdentifier: job.blockchainIdentifier ?? null,
    payByTime: job.payByTime ?? null,
    submitResultTime: job.submitResultTime ?? null,
    unlockTime: job.unlockTime ?? null,
    externalDisputeUnlockTime: job.externalDisputeUnlockTime ?? null,
    sellerVkey: job.sellerVkey ?? null,
    jobStatusSettled: isJobStatusSettled(job, completedAt),
    workspace: mapWorkspaceSummary(job.workspace),
    organization: organizationSummaryFromLoadedRelation(
      `Job ${job.id}`,
      job.organizationId,
      job.organization ?? null,
    ),
  };
}

export function serializeJobDetails(job: JobWithSokosumiStatus) {
  const owner = mapJobOwnerSummary(job);

  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    agentId: job.agentId,
    ownerId: job.ownerId,
    owner,
    // Deprecated aliases — keep until clients migrate.
    userId: job.ownerId,
    user: owner,
    organizationId: job.organizationId,
    projectId: job.projectId ?? null,
    taskId: job.taskId,
    name: job.name,
    jobType: job.jobType,
    status: job.status,
    credits: job.credits,
    onChainStatus: job.purchase?.onChainStatus ?? null,
    onChainTransactionHash: job.purchase?.onChainTransactionHash ?? null,
    result: job.result,
    resultHash: job.resultHash,
    blockchainIdentifier: job.blockchainIdentifier ?? null,
    payByTime: job.payByTime ?? null,
    submitResultTime: job.submitResultTime ?? null,
    unlockTime: job.unlockTime ?? null,
    externalDisputeUnlockTime: job.externalDisputeUnlockTime ?? null,
    sellerVkey: job.sellerVkey ?? null,
    jobStatusSettled: job.jobStatusSettled,
    input: job.input,
    inputHash: job.inputHash,
    inputSchema: job.inputSchema,
    agentJobId: job.agentJobId,
    identifierFromPurchaser: job.identifierFromPurchaser,
    workspace: mapWorkspaceSummary(job.workspace),
    organization: organizationSummaryFromLoadedRelation(
      `Job ${job.id}`,
      job.organizationId,
      job.organization ?? null,
    ),
    agent: {
      id: job.agent.id,
      name: job.agent.name,
      ...getJobDetailsAgentOverrideFields(job.agent),
      icon: job.agent.icon,
      image: job.agent.image,
      legalPrivacyPolicy: job.agent.legalPrivacyPolicy,
      legalTerms: job.agent.legalTerms,
      legalDpa: job.agent.legalDpa,
      legalOther: job.agent.legalOther,
    },
    events: job.events.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      status: event.status,
      inputSchema: event.inputSchema,
      input: event.input
        ? {
            id: event.input.id,
            input: event.input.input,
            inputHash: event.input.inputHash,
            signature: event.input.signature,
          }
        : null,
      result: event.result,
      blobs: event.blobs.map((blob) => ({
        ...blob,
        jobId: job.id,
        size: blob.size === null ? null : Number(blob.size),
      })),
      links: event.links.map((link) => ({
        ...link,
        jobId: job.id,
      })),
    })),
    share: job.share ?? null,
  };
}
