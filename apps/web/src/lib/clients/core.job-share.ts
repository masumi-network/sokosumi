import {
  AgentJobStatus,
  type JobShare,
  JobType,
  type JobWithSokosumiStatus,
  OnChainJobStatus,
  SokosumiJobStatus,
} from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/database/helpers";
import { z } from "zod";

const coreJobShareSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  token: z.string(),
  allowSearchIndexing: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const corePublicSharedJobEventInputSchema = z.object({
  id: z.string(),
  input: z.string(),
  inputHash: z.string().nullable(),
  signature: z.string().nullable(),
});

const corePublicSharedJobBlobSchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  jobId: z.string(),
  sourceUrl: z.string(),
  name: z.string().nullable(),
  status: z.string(),
  size: z.number().nullable(),
  mimeType: z.string().nullable(),
  fileUrl: z.string().nullable(),
});

const corePublicSharedJobLinkSchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  jobId: z.string(),
  url: z.string(),
  title: z.string().nullable(),
});

const corePublicSharedJobEventSchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  status: z.enum(AgentJobStatus),
  inputSchema: z.string().nullable(),
  input: corePublicSharedJobEventInputSchema.nullable(),
  result: z.string().nullable(),
  blobs: z.array(corePublicSharedJobBlobSchema),
  links: z.array(corePublicSharedJobLinkSchema),
});

const corePublicSharedJobUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
});

const corePublicSharedJobAgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  overrideName: z.string().nullable(),
  icon: z.string().nullable(),
  image: z.string().nullable(),
  overrideImage: z.string().nullable(),
  legalPrivacyPolicy: z.string().nullable(),
  overrideLegalPrivacyPolicy: z.string().nullable(),
  legalTerms: z.string().nullable(),
  overrideLegalTerms: z.string().nullable(),
  legalDpa: z.string().nullable(),
  overrideLegalDpa: z.string().nullable(),
  legalOther: z.string().nullable(),
  overrideLegalOther: z.string().nullable(),
});

const corePublicSharedJobSchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  taskId: z.string().nullable(),
  name: z.string().nullable(),
  jobType: z.enum(JobType),
  status: z.enum(SokosumiJobStatus),
  credits: z.number(),
  onChainStatus: z.enum(OnChainJobStatus).nullable(),
  onChainTransactionHash: z.string().nullable(),
  agentJobId: z.string(),
  identifierFromPurchaser: z.string().nullable(),
  user: corePublicSharedJobUserSchema,
  agent: corePublicSharedJobAgentSchema,
  resultHash: z.string().nullable(),
  events: z.array(corePublicSharedJobEventSchema),
});

export function parseCoreJobShare(data: unknown): JobShare {
  const share = coreJobShareSchema.parse(data);

  return {
    ...share,
    createdAt: new Date(share.createdAt),
    updatedAt: new Date(share.updatedAt),
  } as JobShare;
}

export function parseCorePublicSharedJobResponse(
  data: unknown,
): {
  job: JobWithSokosumiStatus;
  share: JobShare;
} {
  const parsedResponse = z
    .object({
      job: corePublicSharedJobSchema,
      share: coreJobShareSchema,
    })
    .parse(data);
  const parsedJob = parsedResponse.job;
  const share = parseCoreJobShare(parsedResponse.share);
  const events = parsedJob.events.map((event) => ({
    ...event,
    createdAt: new Date(event.createdAt),
    updatedAt: new Date(event.updatedAt),
    input: event.input,
    blobs: event.blobs.map((blob) => ({
      ...blob,
      createdAt: new Date(blob.createdAt),
      updatedAt: new Date(blob.updatedAt),
    })),
    links: event.links.map((link) => ({
      ...link,
      createdAt: new Date(link.createdAt),
      updatedAt: new Date(link.updatedAt),
    })),
  }));

  const initiatedEvent = events.at(-1) ?? null;
  const latestResultEvent = events.find((event) => event.result !== null) ?? null;
  const cents = convertCreditsToCents(parsedJob.credits);

  const job = {
    id: parsedJob.id,
    createdAt: new Date(parsedJob.createdAt),
    updatedAt: new Date(parsedJob.updatedAt),
    completedAt: parsedJob.completedAt
      ? new Date(parsedJob.completedAt)
      : null,
    agentId: parsedJob.agent.id,
    userId: parsedJob.user.id,
    organizationId: null,
    taskId: parsedJob.taskId,
    name: parsedJob.name,
    jobType: parsedJob.jobType,
    status: parsedJob.status,
    credits: parsedJob.credits,
    onChainStatus: parsedJob.onChainStatus,
    onChainTransactionHash: parsedJob.onChainTransactionHash,
    result: latestResultEvent?.result ?? null,
    resultHash: parsedJob.resultHash,
    input: initiatedEvent?.input?.input ?? null,
    inputHash: initiatedEvent?.input?.inputHash ?? null,
    inputSchema: initiatedEvent?.inputSchema ?? null,
    agentJobId: parsedJob.agentJobId,
    identifierFromPurchaser: parsedJob.identifierFromPurchaser,
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
    events,
    cents,
    jobStatusSettled: false,
    user: parsedJob.user,
    organization: null,
    agent: parsedJob.agent,
  } as unknown as JobWithSokosumiStatus;

  return { job, share };
}
