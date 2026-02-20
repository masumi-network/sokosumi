import { z } from "@hono/zod-openapi";

export const createCoworkerUsageRequestSchema = z.object({
  userId: z.string().min(1).openapi({ example: "user_123" }),
  organizationId: z
    .string()
    .nullable()
    .openapi({ example: "org_123" }),
  idempotencyKey: z.string().min(1).openapi({ example: "usage_456" }),
  credits: z.number().gt(0).openapi({ example: 2.5 }),
  referenceId: z.string().min(1).optional().openapi({ example: "ref_789" }),
});
