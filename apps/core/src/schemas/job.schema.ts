import { z } from "@hono/zod-openapi";
import { AgentJobStatus, JobType } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/database/types/job";
import type {
  InputFieldSchemaType,
  InputSchemaSchemaType,
} from "@sokosumi/masumi/schemas";
import { inputGroupsSchema } from "@sokosumi/masumi/schemas";

import { dateTimeSchema } from "@/helpers/datetime.js";

import { fileSchema } from "./file.schema.js";
import { linkSchema } from "./link.schema.js";

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
    blobs: z.array(fileSchema).openapi({ example: [] }),
    links: z.array(linkSchema).openapi({ example: [] }),
  })
  .openapi("Job Event");

export const jobEventsSchema = z.array(jobEventSchema);

export const jobSchema = z
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
    name: z.string().nullish().openapi({ example: "My Job" }),
    jobType: z.enum(JobType).openapi({ example: JobType.PAID }),
    status: z
      .enum(SokosumiJobStatus)
      .openapi({ example: SokosumiJobStatus.PROCESSING }),
    credits: z.number().openapi({ example: 5 }),
    result: z.string().nullish().openapi({ example: "Markdown text" }),
    resultHash: z.string().nullish().openapi({ example: "result_hash" }),
  })
  .openapi("Job");

export const jobsSchema = z.array(jobSchema);

export const createJobRequestSchema = z
  .object({
    maxAcceptedCredits: z.number().positive(),
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
    name: z.string().min(1).max(80).optional(),
    share: z.boolean().default(false),
  })
  .openapi("CreateJobRequest");

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
  z
    .object({
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
    })
    .openapi("StartPaidJobResponse"),
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
