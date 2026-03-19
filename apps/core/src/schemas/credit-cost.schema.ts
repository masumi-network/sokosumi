import { z } from "@hono/zod-openapi";
import type { CreditCost as DatabaseCreditCost } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const creditCostSchema = z
  .object({
    id: z.string().openapi({ example: "clxx123" }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    unit: z.string().openapi({ example: "TOKEN" }),
    creditsPerUnit: z.number().min(0).openapi({
      example: 100,
      description: "Credits charged per unit (user-facing decimal)",
    }),
  })
  .openapi("CreditCost");

export type CreditCost = z.infer<typeof creditCostSchema>;

export const createCreditCostRequestSchema = z
  .object({
    unit: z.string().min(1).openapi({ example: "TOKEN" }),
    creditsPerUnit: z.number().min(0).openapi({ example: 100 }),
  })
  .openapi("CreateCreditCostRequest");

export const patchCreditCostRequestSchema = z
  .object({
    unit: z.string().min(1).optional().openapi({ example: "TOKEN" }),
    creditsPerUnit: z.number().min(0).optional().openapi({ example: 100 }),
  })
  .refine(
    (data) => data.unit !== undefined || data.creditsPerUnit !== undefined,
    {
      message: "At least one of unit or creditsPerUnit is required",
    },
  )
  .openapi("PatchCreditCostRequest");

export function mapCreditCostForApi(record: DatabaseCreditCost) {
  return {
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    unit: record.unit,
    creditsPerUnit: convertCentsToCredits(record.centsPerUnit),
  };
}
