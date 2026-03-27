import { z } from "@hono/zod-openapi";
import { AgentJobStatus, JobType, OnChainJobStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/database/types/job";

import { dateTimeSchema } from "@/helpers/datetime.js";

import { fileSchema } from "./file.schema.js";
import { linkSchema } from "./link.schema.js";

export const jobShareSchema = z
  .object({
    id: z.string().openapi({ example: "share_123" }),
    jobId: z.string().openapi({ example: "job_123" }),
    token: z.string().openapi({ example: "public-share-token" }),
    allowSearchIndexing: z.boolean().openapi({ example: true }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("JobShare");

export const putJobShareRequestSchema = z.object({
  allowSearchIndexing: z.boolean().openapi({ example: true }),
});

const publicSharedJobUserSchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Ada Lovelace" }),
    image: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/avatar.png" }),
  })
  .openapi("PublicSharedJobUser");

const publicSharedJobAgentSchema = z
  .object({
    id: z.string().openapi({ example: "agent_123" }),
    name: z.string().openapi({ example: "Research Agent" }),
    overrideName: z
      .string()
      .nullish()
      .openapi({ example: "My Research Agent" }),
    icon: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/icon.png" }),
    image: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/image.png" }),
    overrideImage: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/override-image.png" }),
    legalPrivacyPolicy: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/privacy" }),
    overrideLegalPrivacyPolicy: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/custom-privacy" }),
    legalTerms: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/terms" }),
    overrideLegalTerms: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/custom-terms" }),
    legalDpa: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/dpa" }),
    overrideLegalDpa: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/custom-dpa" }),
    legalOther: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/support" }),
    overrideLegalOther: z
      .string()
      .nullish()
      .openapi({ example: "https://example.com/custom-support" }),
  })
  .openapi("PublicSharedJobAgent");

const publicSharedJobEventInputSchema = z
  .object({
    id: z.string().openapi({ example: "input_123" }),
    input: z.string().openapi({
      example: '{"prompt":"How many planets are in the solar system?"}',
    }),
    inputHash: z.string().nullish().openapi({ example: "input_hash_123" }),
    signature: z.string().nullish().openapi({ example: "signature_123" }),
  })
  .openapi("PublicSharedJobEventInput");

const publicSharedJobTransactionSchema = z
  .object({
    amount: z.string().openapi({ example: "5000000" }),
  })
  .openapi("PublicSharedJobTransaction");

const publicSharedJobPurchaseSchema = z
  .object({
    onChainStatus: z
      .enum(OnChainJobStatus)
      .nullish()
      .openapi({ example: OnChainJobStatus.RESULT_SUBMITTED }),
    onChainTransactionHash: z
      .string()
      .nullish()
      .openapi({ example: "0x123abc" }),
    resultHash: z.string().nullish().openapi({ example: "result_hash_123" }),
  })
  .openapi("PublicSharedJobPurchase");

export const publicSharedJobEventSchema = z
  .object({
    id: z.string().openapi({ example: "event_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    status: z
      .enum(AgentJobStatus)
      .openapi({ example: AgentJobStatus.COMPLETED }),
    inputSchema: z.string().nullish().openapi({ example: "input_schema_123" }),
    input: publicSharedJobEventInputSchema.nullish(),
    result: z.string().nullish().openapi({ example: "# Result" }),
    blobs: z.array(fileSchema).openapi({ example: [] }),
    links: z.array(linkSchema).openapi({ example: [] }),
  })
  .openapi("PublicSharedJobEvent");

export const publicSharedJobSchema = z
  .object({
    id: z.string().openapi({ example: "job_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    completedAt: dateTimeSchema.nullish(),
    taskId: z.string().nullish().openapi({ example: "task_123" }),
    name: z.string().nullish().openapi({ example: "Research Task" }),
    jobType: z.enum(JobType).openapi({ example: JobType.PAID }),
    status: z
      .enum(SokosumiJobStatus)
      .openapi({ example: SokosumiJobStatus.COMPLETED }),
    credits: z.number().openapi({ example: 5 }),
    agentJobId: z.string().openapi({ example: "agent_job_123" }),
    identifierFromPurchaser: z
      .string()
      .nullish()
      .openapi({ example: "identifier_123" }),
    user: publicSharedJobUserSchema,
    agent: publicSharedJobAgentSchema,
    transaction: publicSharedJobTransactionSchema.nullish(),
    purchase: publicSharedJobPurchaseSchema.nullish(),
    events: z.array(publicSharedJobEventSchema),
  })
  .openapi("PublicSharedJob");

export const publicSharedJobResponseSchema = z
  .object({
    job: publicSharedJobSchema,
    share: jobShareSchema,
  })
  .openapi("PublicSharedJobResponse");
