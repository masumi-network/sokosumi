import { z } from "@hono/zod-openapi";

import { LIMITS } from "@/config/constants";

/** Bills org pool when orchestrator context has an organization; otherwise personal credits. */
export const createOrchestratorUsageRequestSchema = z
  .object({
    userId: z.string().min(1).openapi({ example: "user_123" }),
    idempotencyKey: z.string().min(1).openapi({ example: "usage_456" }),
    credits: z.number().positive().openapi({ example: 2.5 }),
    referenceId: z.string().min(1).optional().openapi({ example: "ref_789" }),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.credits < LIMITS.MIN_CHARGEABLE_CREDITS) {
      ctx.addIssue({
        code: "custom",
        message: `Credit amount is below the minimum chargeable value (${LIMITS.MIN_CHARGEABLE_CREDITS})`,
        path: ["credits"],
      });
    }
  });
