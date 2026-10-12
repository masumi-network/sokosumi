import { z } from "@hono/zod-openapi";
import { dateTimeSchema } from "@/helpers/datetime";

export const sokoBotPendingDecisionSchema = z
  .object({
    id: z.string().uuid(),
    turnId: z.string().uuid(),
    toolName: z.string(),
    proposal: z.record(z.string(), z.unknown()),
    reason: z.string(),
    status: z.enum([
      "PENDING",
      "PROCESSING",
      "ACCEPTED",
      "REJECTED",
      "EXPIRED",
    ]),
    expiresAt: dateTimeSchema,
    resolvedAt: dateTimeSchema.nullable(),
    resultingEntityId: z.string().nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .openapi("SokoBotPendingDecision");
