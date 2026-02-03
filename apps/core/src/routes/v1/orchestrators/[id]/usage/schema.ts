import { z } from "@hono/zod-openapi";

export const createOrchestratorUsageRequestSchema = z.object({
  idempotencyKey: z.string().min(1).openapi({ example: "usage_456" }),
  credits: z.number().min(0).finite().openapi({ example: 2.5 }),
  referenceId: z.string().optional().openapi({ example: "ref_789" }),
});
