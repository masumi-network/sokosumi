import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

const publicShareBaseSchema = z.object({
  id: z.string().openapi({ example: "share_123" }),
  token: z.string().openapi({ example: "public-share-token" }),
  allowSearchIndexing: z.boolean().openapi({ example: true }),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

export const jobShareSchema = publicShareBaseSchema
  .extend({
    jobId: z.string().openapi({ example: "job_123" }),
  })
  .openapi("JobShare");

export const taskShareSchema = publicShareBaseSchema
  .extend({
    taskId: z.string().openapi({ example: "tsk_123" }),
  })
  .openapi("TaskShare");
