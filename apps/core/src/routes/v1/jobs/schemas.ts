import { z } from "@hono/zod-openapi";
import { JobStatus } from "@sokosumi/database/types/job";

export const jobSchema = z
  .object({
    id: z.string().openapi({ example: "job_123" }),
    agentId: z.string().openapi({ example: "agent_123" }),
    userId: z.string().openapi({ example: "user_123" }),
    organizationId: z
      .string()
      .nullish()
      .openapi({ example: "organization_123" }),
    status: z.enum(JobStatus).openapi({ example: JobStatus.PROCESSING }),
    input: z
      .string()
      .openapi({
        example: '{"prompt":"How many planets are in the solar system?"}',
      }),
    result: z.string().nullish().openapi({ example: "Markdown text" }),
  })
  .openapi("Job");
