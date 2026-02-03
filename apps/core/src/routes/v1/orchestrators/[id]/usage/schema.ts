import { z } from "@hono/zod-openapi";

export const createOrchestratorUsageRequestSchema = z.object({
  idempotencyKey: z.string().min(1).openapi({ example: "usage_456" }),
  credits: z.number().gt(0).openapi({ example: 2.5 }),
  referenceId: z.string().min(1).optional().openapi({ example: "ref_789" }),
});
