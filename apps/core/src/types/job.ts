import {
  type JobWithEvents,
  type JobWithPurchase,
  type JobWithSokosumiStatus,
  type JobWithTransaction,
} from "@sokosumi/database";
import {
  computeJobStatus,
  getCompletedAt,
  getCredits,
  getResult,
  getResultHash,
} from "@sokosumi/database/helpers";

export function flattenJob(
  job: JobWithEvents & JobWithTransaction & JobWithPurchase,
) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    agentId: job.agentId,
    userId: job.userId,
    organizationId: job.organizationId,
    taskId: job.taskId,
    name: job.name,
    jobType: job.jobType,
    completedAt: getCompletedAt(job),
    onChainStatus: job.purchase?.onChainStatus ?? null,
    onChainTransactionHash: job.purchase?.onChainTransactionHash ?? null,
    result: getResult(job),
    resultHash: getResultHash(job),
    credits: getCredits(job),
    status: computeJobStatus(job),
  };
}

export function serializeJobDetails(job: JobWithSokosumiStatus) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    agentId: job.agentId,
    userId: job.userId,
    organizationId: job.organizationId,
    taskId: job.taskId,
    name: job.name,
    jobType: job.jobType,
    status: job.status,
    credits: job.credits,
    onChainStatus: job.purchase?.onChainStatus ?? null,
    onChainTransactionHash: job.purchase?.onChainTransactionHash ?? null,
    result: job.result,
    resultHash: job.resultHash,
    input: job.input,
    inputHash: job.inputHash,
    inputSchema: job.inputSchema,
    agentJobId: job.agentJobId,
    identifierFromPurchaser: job.identifierFromPurchaser,
    user: {
      id: job.user.id,
      name: job.user.name,
      image: job.user.image,
    },
    organization: job.organization
      ? {
          id: job.organization.id,
          name: job.organization.name,
          slug: job.organization.slug,
        }
      : null,
    agent: {
      id: job.agent.id,
      name: job.agent.name,
      overrideName: job.agent.overrideName,
      icon: job.agent.icon,
      image: job.agent.image,
      overrideImage: job.agent.overrideImage,
      legalPrivacyPolicy: job.agent.legalPrivacyPolicy,
      overrideLegalPrivacyPolicy: job.agent.overrideLegalPrivacyPolicy,
      legalTerms: job.agent.legalTerms,
      overrideLegalTerms: job.agent.overrideLegalTerms,
      legalDpa: job.agent.legalDpa,
      overrideLegalDpa: job.agent.overrideLegalDpa,
      legalOther: job.agent.legalOther,
      overrideLegalOther: job.agent.overrideLegalOther,
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
        size: blob.size === null ? null : Number(blob.size),
      })),
      links: event.links,
    })),
  };
}
