import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const orchestratorUsageSchema = z
  .object({
    id: z.string().openapi({ example: "ous_123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    idempotencyKey: z.string().openapi({ example: "usage_456" }),
    referenceId: z.string().nullable().openapi({ example: "ref_789" }),
    orchestratorId: z.string().openapi({ example: "orc_123" }),
    userId: z.string().openapi({ example: "user_123" }),
    organizationId: z.string().nullable().openapi({ example: "org_123" }),
    credits: z.number().openapi({ example: 2.5 }),
    transactionId: z.string().openapi({ example: "txn_123" }),
  })
  .openapi("OrchestratorUsage");
