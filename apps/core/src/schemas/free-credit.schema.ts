import { z } from "@hono/zod-openapi";

import { MAX_ADMIN_CREDIT_TTL_DAYS } from "@/lib/admin-credit-grant";
import { invoiceTargetTypeSchema } from "./invoice.schema.js";

export const freeCreditGrantSchema = z
  .object({
    bucketId: z.string().openapi({ example: "bucket_123" }),
    targetType: invoiceTargetTypeSchema,
    targetId: z.string().openapi({ example: "user_123" }),
    targetName: z.string().openapi({ example: "Ada Lovelace" }),
    credits: z.number().openapi({ example: 500 }),
    ttlDays: z.number().nullable().openapi({ example: 30 }),
    referenceNote: z.string().nullable().openapi({ example: "Billing issue" }),
  })
  .openapi("FreeCreditGrant");

export const createFreeCreditGrantSchema = z
  .object({
    targetType: invoiceTargetTypeSchema,
    targetId: z.string().min(1).openapi({ example: "user_123" }),
    credits: z.number().int().positive().openapi({ example: 500 }),
    ttlDays: z
      .number()
      .int()
      .positive()
      .max(MAX_ADMIN_CREDIT_TTL_DAYS)
      .nullable()
      .openapi({ example: 30 }),
    referenceNote: z
      .union([z.string(), z.null()])
      .transform((value) => {
        if (value === null) {
          return null;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      })
      .pipe(z.union([z.string().max(500), z.null()]))
      .openapi({ example: "Billing issue" }),
  })
  .openapi("CreateFreeCreditGrant");
