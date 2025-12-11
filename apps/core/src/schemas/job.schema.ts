import { z } from "@hono/zod-openapi";
import { JobType } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/database/types/job";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const jobSchema = z
  .object({
    id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
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
    completedAt: dateTimeSchema.nullish(),
    credits: z.number().openapi({ example: 5 }),
    input: z.string().openapi({
      example: '{"prompt":"How many planets are in the solar system?"}',
    }),
    inputHash: z.string().nullish().openapi({ example: "input_hash" }),
    inputSchema: z.string().nullish(),
    inputRequests: z
      .array(
        z.object({
          id: z.string().openapi({ example: "input_request_123" }),
          createdAt: dateTimeSchema,
          message: z
            .string()
            .nullish()
            .openapi({ example: "How many planets are in the solar system?" }),
          inputSchema: z.string().openapi({ example: "input_schema" }),
          input: z.string().openapi({
            example: '{"prompt":"How many planets are in the solar system?"}',
          }),
          inputHash: z.string().openapi({ example: "input_hash" }),
          signature: z.string().openapi({ example: "signature" }),
        }),
      )
      .openapi({
        example: [
          {
            id: "input_request_123",
            createdAt: "2025-01-01T00:00:00.000Z",
            message: "How many planets are in the solar system?",
            inputSchema: "input_schema",
            input: '{"prompt":"How many planets are in the solar system?"}',
            inputHash: "input_hash",
            signature: "signature",
          },
          {
            id: "input_request_124",
            createdAt: "2025-01-02T00:00:00.000Z",
            message: "How many planets are in the solar system?",
            inputSchema: "input_schema",
            input: '{"prompt":"How many planets are in the solar system?"}',
            inputHash: "input_hash",
            signature: "signature",
          },
        ],
      }),
    result: z.string().nullish().openapi({ example: "Markdown text" }),
    resultHash: z.string().nullish().openapi({ example: "result_hash" }),
  })
  .openapi("Job");

export const jobsSchema = z.array(jobSchema);

export const jobInputSchema = z.object({
  id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
  statusId: z.string().openapi({ example: "status_123" }),
  input: z
    .string()
    .openapi({
      example: '{"prompt":"How many planets are in the solar system?"}',
    }),
  inputHash: z.string().nullish().openapi({ example: "input_hash" }),
  signature: z.string().nullish().openapi({ example: "signature" }),
});
