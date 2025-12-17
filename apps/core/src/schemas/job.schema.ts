import { z } from "@hono/zod-openapi";
import { AgentJobStatus, JobType } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/database/types/job";

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
