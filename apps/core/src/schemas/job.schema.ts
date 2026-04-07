import { z } from "@hono/zod-openapi";
import { AgentJobStatus, JobType, OnChainJobStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/database/types/job";
import type {
  InputFieldSchemaType,
  InputSchemaSchemaType,
} from "@sokosumi/masumi/schemas";
import { inputGroupsSchema, inputSchemaSchema } from "@sokosumi/masumi/schemas";

import { dateTimeSchema } from "@/helpers/datetime.js";

import { fileSchema } from "./file.schema.js";
import { linkSchema } from "./link.schema.js";
import { workspaceSummarySchema } from "./workspace.schema.js";

export const jobInputSchema = z
  .object({
    id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    input: z.string().openapi({
      example: '{"prompt":"How many planets are in the solar system?"}',
    }),
    inputHash: z.string().nullish().openapi({ example: "input_hash" }),
    signature: z.string().nullish().openapi({ example: "signature" }),
  })
  .openapi("Job Input");

export const jobEventSchema = z
  .object({
    id: z.string().openapi({ example: "event_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    status: z.enum(AgentJobStatus).openapi({ example: AgentJobStatus.RUNNING }),
    inputSchema: z.string().nullish().openapi({ example: "input_schema" }),
    input: jobInputSchema.nullish(),
    result: z.string().nullish().openapi({ example: "Markdown text" }),
    files: z.array(fileSchema).openapi({ example: [] }),
    links: z.array(linkSchema).openapi({ example: [] }),
  })
  .openapi("Job Event");

export const jobEventsSchema = z.array(jobEventSchema);

export const jobSummarySchema = z
  .object({
    id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    completedAt: dateTimeSchema.nullish(),
    agentId: z.string().openapi({ example: "agent_123" }),
    userId: z.string().openapi({ example: "user_123" }),
    organizationId: z
      .string()
      .nullish()
      .openapi({ example: "organization_123" }),
    taskId: z.string().nullish().openapi({ example: "task_123" }),
    name: z.string().nullish().openapi({ example: "My Job" }),
    jobType: z.enum(JobType).openapi({ example: JobType.PAID }),
    status: z
      .enum(SokosumiJobStatus)
      .openapi({ example: SokosumiJobStatus.PROCESSING }),
    credits: z.number().openapi({ example: 5 }),
    onChainStatus: z
      .enum(OnChainJobStatus)
      .nullish()
      .openapi({ example: OnChainJobStatus.RESULT_SUBMITTED }),
    onChainTransactionHash: z
      .string()
      .nullish()
      .openapi({ example: "0x123abc" }),
    result: z.string().nullish().openapi({ example: "Markdown text" }),
    resultHash: z.string().nullish().openapi({ example: "result_hash" }),
    workspace: workspaceSummarySchema,
  })
  .openapi("JobSummary");

export const jobSummariesSchema = z.array(jobSummarySchema);

export const jobDetailsUserSchema = z.object({
  id: z.string().openapi({ example: "user_123" }),
  name: z.string().openapi({ example: "Ada Lovelace" }),
  image: z
    .string()
    .nullish()
    .openapi({ example: "https://example.com/avatar.png" }),
});

export const jobDetailsOrganizationSchema = z.object({
  id: z.string().openapi({ example: "org_123" }),
  name: z.string().openapi({ example: "Acme Labs" }),
  slug: z.string().openapi({ example: "acme-labs" }),
});

export const jobDetailsAgentSchema = z.object({
  id: z.string().openapi({ example: "agent_123" }),
  name: z.string().openapi({ example: "Research Agent" }),
  overrideName: z.string().nullish().openapi({ example: "My Research Agent" }),
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
});

export const jobDetailsEventInputSchema = z.object({
  id: z.string().openapi({ example: "input_123" }),
  input: z.string().openapi({
    example: '{"prompt":"How many planets are in the solar system?"}',
  }),
  inputHash: z.string().nullish().openapi({ example: "input_hash_123" }),
  signature: z.string().nullish().openapi({ example: "signature_123" }),
});

export const jobDetailsEventSchema = z.object({
  id: z.string().openapi({ example: "event_123" }),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  status: z.enum(AgentJobStatus).openapi({ example: AgentJobStatus.COMPLETED }),
  inputSchema: z.string().nullish().openapi({ example: "input_schema_123" }),
  input: jobDetailsEventInputSchema.nullish(),
  result: z.string().nullish().openapi({ example: "# Result" }),
  blobs: z.array(fileSchema).openapi({ example: [] }),
  links: z.array(linkSchema).openapi({ example: [] }),
});

export const jobSchema = z
  .object({
    id: z.string().openapi({ example: "job_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    completedAt: dateTimeSchema.nullish(),
    agentId: z.string().openapi({ example: "agent_123" }),
    userId: z.string().openapi({ example: "user_123" }),
    organizationId: z
      .string()
      .nullish()
      .openapi({ example: "organization_123" }),
    taskId: z.string().nullish().openapi({ example: "task_123" }),
    name: z.string().nullish().openapi({ example: "Research Task" }),
    jobType: z.enum(JobType).openapi({ example: JobType.PAID }),
    status: z
      .enum(SokosumiJobStatus)
      .openapi({ example: SokosumiJobStatus.COMPLETED }),
    credits: z.number().openapi({ example: 5 }),
    onChainStatus: z
      .enum(OnChainJobStatus)
      .nullish()
      .openapi({ example: OnChainJobStatus.RESULT_SUBMITTED }),
    onChainTransactionHash: z
      .string()
      .nullish()
      .openapi({ example: "0x123abc" }),
    result: z.string().nullish().openapi({ example: "# Result" }),
    resultHash: z.string().nullish().openapi({ example: "result_hash_123" }),
    input: z.string().nullish().openapi({
      example: '{"prompt":"How many planets are in the solar system?"}',
    }),
    inputHash: z.string().nullish().openapi({ example: "input_hash_123" }),
    inputSchema: z.string().nullish().openapi({ example: "input_schema_123" }),
    agentJobId: z.string().openapi({ example: "agent_job_123" }),
    identifierFromPurchaser: z
      .string()
      .nullish()
      .openapi({ example: "identifier_123" }),
    workspace: workspaceSummarySchema,
    user: jobDetailsUserSchema,
    organization: jobDetailsOrganizationSchema.nullish(),
    agent: jobDetailsAgentSchema,
    events: z.array(jobDetailsEventSchema),
  })
  .openapi("Job");

export const createJobRequestSchema = z.object({
  inputSchema: inputSchemaSchema,
  inputData: z.record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.string()),
      z.array(z.number()),
    ]),
  ),
  maxCredits: z.number().positive().optional().openapi({ example: 10 }),
  name: z.string().min(1).max(80).optional().openapi({
    example: "My Job",
    description:
      "If not provided, an AI-generated name will be created based on the agent details and input data.",
  }),
});

// Preprocess function to handle backward compatibility (job_id -> id)
function preprocessStartJobResponse(val: unknown): unknown {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const { job_id, ...rest } = obj;
    return {
      ...rest,
      id: obj.id ?? job_id,
    };
  }
  return val;
}

export const startPaidJobResponseSchema = z.preprocess(
  preprocessStartJobResponse,
  z.object({
    id: z.string().min(1),
    input_hash: z.string().min(1),
    identifierFromPurchaser: z.string().min(1),
    blockchainIdentifier: z.string().min(1),
    payByTime: z.coerce.number().int(),
    submitResultTime: z.coerce.number().int(),
    unlockTime: z.coerce.number().int(),
    externalDisputeUnlockTime: z.coerce.number().int(),
    agentIdentifier: z.string().min(1),
    sellerVKey: z.string().min(1),
  }),
);

export type StartPaidJobResponseSchemaType = z.infer<
  typeof startPaidJobResponseSchema
>;

// Helper function to flatten input schema (handles both grouped and flat schemas)
const groupedInputSchema = z.object({
  input_groups: inputGroupsSchema,
});

type GroupedInputSchema = z.infer<typeof groupedInputSchema>;

function isGroupedSchema(
  schema: InputSchemaSchemaType,
): schema is GroupedInputSchema {
  return groupedInputSchema.safeParse(schema).success;
}

export function flattenInputs(
  schema: InputSchemaSchemaType,
): InputFieldSchemaType[] {
  if (isGroupedSchema(schema)) {
    return schema.input_groups.flatMap((group) => group.input_data);
  }
  return schema.input_data;
}
