import type { JobShare, JobWithSokosumiStatus } from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/utils";

import type {
  Job as CoreJob,
  JobShare as CoreJobShare,
  PublicSharedJobResource as CorePublicSharedJobResource,
  TaskShare as CoreTaskShare,
  PublicSharedResourceResponse,
  PublicSharedTask,
} from "@/lib/clients/generated/core";

export interface PublicSharedJobResource {
  kind: "job";
  job: JobWithSokosumiStatus;
  share: JobShare;
}

export interface PublicSharedTaskResource {
  kind: "task";
  task: PublicSharedTask;
  share: CoreTaskShare;
}

export type PublicSharedResource =
  | PublicSharedJobResource
  | PublicSharedTaskResource;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function mapCoreJobShare(share: CoreJobShare): JobShare {
  return {
    id: share.id,
    jobId: share.jobId,
    token: share.token,
    allowSearchIndexing: share.allowSearchIndexing,
    createdAt: toDate(share.createdAt),
    updatedAt: toDate(share.updatedAt),
  } as JobShare;
}

function mapCoreTaskShare(share: CoreTaskShare): CoreTaskShare {
  return {
    ...share,
    createdAt: toDate(share.createdAt),
    updatedAt: toDate(share.updatedAt),
  };
}

function mapCorePublicSharedTask(task: PublicSharedTask): PublicSharedTask {
  return {
    ...task,
    createdAt: toDate(task.createdAt),
    updatedAt: toDate(task.updatedAt),
    jobs: task.jobs.map((job) => ({
      ...job,
      createdAt: toDate(job.createdAt),
      completedAt: job.completedAt ? toDate(job.completedAt) : null,
    })),
    events: task.events.map((event) => ({
      ...event,
      createdAt: toDate(event.createdAt),
      updatedAt: toDate(event.updatedAt),
    })),
  };
}

function mapCoreSharedJobEvent(event: CoreJob["events"][number]) {
  return {
    id: event.id,
    createdAt: toDate(event.createdAt),
    updatedAt: toDate(event.updatedAt),
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
      createdAt: toDate(blob.createdAt),
      updatedAt: toDate(blob.updatedAt),
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
      createdAt: toDate(link.createdAt),
      updatedAt: toDate(link.updatedAt),
      jobId: link.jobId,
      url: link.url,
      title: link.title ?? null,
    })),
  };
}

function mapCoreSharedJob(
  job: CoreJob,
  share: JobShare,
): JobWithSokosumiStatus {
  const cents = convertCreditsToCents(job.credits);

  return {
    id: job.id,
    createdAt: toDate(job.createdAt),
    updatedAt: toDate(job.updatedAt),
    completedAt: job.completedAt ? toDate(job.completedAt) : null,
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
    events: job.events.map((event) => mapCoreSharedJobEvent(event)),
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

export function mapCorePublicSharedJobResponse(
  data: CorePublicSharedJobResource,
): {
  job: JobWithSokosumiStatus;
  share: JobShare;
} {
  const share = mapCoreJobShare(data.share);
  const job = mapCoreSharedJob(data.job, share);

  return { job, share };
}

export function mapCorePublicSharedResourceResponse(
  data: PublicSharedResourceResponse,
): PublicSharedResource {
  if (data.kind === "job") {
    const { job, share } = mapCorePublicSharedJobResponse(data);

    return {
      kind: "job",
      job,
      share,
    };
  }

  return {
    kind: "task",
    task: mapCorePublicSharedTask(data.task),
    share: mapCoreTaskShare(data.share),
  };
}
