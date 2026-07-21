import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const orchestratorUsageSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-0000000000bb",
    }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    idempotencyKey: z.string().openapi({ example: "usage_456" }),
    referenceId: z.string().nullable().openapi({ example: "ref_789" }),
    orchestratorId: z.string().uuid().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    userId: z.string().openapi({ example: "user_123" }),
    credits: z.number().openapi({ example: 2.5 }),
    transactionId: z.string().openapi({ example: "txn_123" }),
  })
  .openapi("OrchestratorUsage");
