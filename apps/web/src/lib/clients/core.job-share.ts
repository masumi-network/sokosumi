import { type JobShare, type JobWithSokosumiStatus } from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/database/helpers";

import type {
  Job as CoreJob,
  JobShare as CoreJobShare,
  PublicSharedJobResponse,
} from "@/lib/clients/generated/core";

export function mapCoreJobShare(share: CoreJobShare): JobShare {
  return {
    id: share.id,
    jobId: share.jobId,
    token: share.token,
    allowSearchIndexing: share.allowSearchIndexing,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
  } as JobShare;
}

function mapCoreSharedJob(
  job: CoreJob,
  share: JobShare,
): JobWithSokosumiStatus {
  const cents = convertCreditsToCents(job.credits);

  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt ?? null,
    agentId: job.agentId,
    userId: job.userId,
    organizationId: job.organizationId ?? null,
    taskId: job.taskId ?? null,
    name: job.name ?? null,
    jobType: job.jobType,
    status: job.status,
    credits: job.credits,
    onChainStatus: job.onChainStatus ?? null,
    onChainTransactionHash: job.onChainTransactionHash ?? null,
    result: job.result ?? null,
    resultHash: job.resultHash ?? null,
    input: job.input ?? null,
    inputHash: job.inputHash ?? null,
    inputSchema: job.inputSchema ?? null,
    agentJobId: job.agentJobId,
    identifierFromPurchaser: job.identifierFromPurchaser ?? null,
    blockchainIdentifier: null,
    payByTime: null,
    submitResultTime: null,
    unlockTime: null,
    externalDisputeUnlockTime: null,
    sellerVkey: null,
    purchaseId: null,
    transactionId: null,
    refundedTransaction: null,
    refundedTransactionId: null,
    share,
    task: null,
    purchase: null,
    transaction: null,
    jobScheduleId: null,
    jobSchedule: null,
    events: job.events.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      status: event.status,
      inputSchema: event.inputSchema ?? null,
      input: event.input
        ? {
            id: event.input.id,
            input: event.input.input,
            inputHash: event.input.inputHash ?? null,
            signature: event.input.signature ?? null,
          }
        : null,
      result: event.result ?? null,
      blobs: event.blobs.map((blob) => ({
        id: blob.id,
        createdAt: blob.createdAt,
        updatedAt: blob.updatedAt,
        jobId: blob.jobId,
        sourceUrl: blob.sourceUrl,
        name: blob.name ?? null,
        status: blob.status,
        size: blob.size ?? null,
        mimeType: blob.mimeType ?? null,
        fileUrl: blob.fileUrl ?? null,
      })),
      links: event.links.map((link) => ({
        id: link.id,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
        jobId: link.jobId,
        url: link.url,
        title: link.title ?? null,
      })),
    })),
    cents,
    jobStatusSettled: false,
    user: {
      id: job.user.id,
      name: job.user.name,
      image: job.user.image ?? null,
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
      overrideName: job.agent.overrideName ?? null,
      icon: job.agent.icon ?? null,
      image: job.agent.image ?? null,
      overrideImage: job.agent.overrideImage ?? null,
      legalPrivacyPolicy: job.agent.legalPrivacyPolicy ?? null,
      overrideLegalPrivacyPolicy: job.agent.overrideLegalPrivacyPolicy ?? null,
      legalTerms: job.agent.legalTerms ?? null,
      overrideLegalTerms: job.agent.overrideLegalTerms ?? null,
      legalDpa: job.agent.legalDpa ?? null,
      overrideLegalDpa: job.agent.overrideLegalDpa ?? null,
      legalOther: job.agent.legalOther ?? null,
      overrideLegalOther: job.agent.overrideLegalOther ?? null,
    },
  } as unknown as JobWithSokosumiStatus;
}

export function mapCorePublicSharedJobResponse(data: PublicSharedJobResponse): {
  job: JobWithSokosumiStatus;
  share: JobShare;
} {
  const share = mapCoreJobShare(data.share);
  const job = mapCoreSharedJob(data.job, share);

  return { job, share };
}
