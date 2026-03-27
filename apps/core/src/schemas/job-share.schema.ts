import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

import { jobSchema } from "./job.schema.js";

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

export const publicSharedJobResponseSchema = z
  .object({
    job: jobSchema,
    share: jobShareSchema,
  })
  .openapi("PublicSharedJobResponse");
