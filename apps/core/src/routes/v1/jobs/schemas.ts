import { z } from "@hono/zod-openapi";
import { JobType } from "@sokosumi/database";
import { JobStatus } from "@sokosumi/database/types/job";

export const jobSchema = z
  .object({
    id: z.string().openapi({ example: "cmi4gmksz000104l8wps8p7fp" }),
    createdAt: z
      .date()
      .openapi({ example: new Date("2021-01-01T00:00:00.000Z") }),
    updatedAt: z
      .date()
      .openapi({ example: new Date("2021-01-01T00:00:00.000Z") }),
    agentId: z.string().openapi({ example: "agent_123" }),
    userId: z.string().openapi({ example: "user_123" }),
    organizationId: z
      .string()
      .nullish()
      .openapi({ example: "organization_123" }),
    name: z.string().nullish().openapi({ example: "My Job" }),
    jobType: z.enum(JobType).openapi({ example: JobType.PAID }),
    status: z.enum(JobStatus).openapi({ example: JobStatus.PROCESSING }),
    completedAt: z
      .date()
      .nullish()
      .openapi({ example: new Date("2021-01-01T00:00:00.000Z") }),
    credits: z.number().openapi({ example: 5 }),
    input: z.string().openapi({
      example: '{"prompt":"How many planets are in the solar system?"}',
    }),
    inputHash: z.string().nullish().openapi({ example: "input_hash" }),
    inputSchema: z.string().nullish().openapi({ example: "input_schema" }),
    result: z.string().nullish().openapi({ example: "Markdown text" }),
    resultHash: z.string().nullish().openapi({ example: "result_hash" }),
    hasFiles: z.boolean().openapi({ example: false }),
  })
  .openapi("Job");
