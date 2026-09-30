import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { masumiPaymentPayloadSchema } from "@/routes/v1/tasks/[id]/events/schema";

export const mpsQuoteTermsSchema = masumiPaymentPayloadSchema
  .omit({ PaymentSource: true })
  .extend({
    paymentId: z.string().min(1).max(250),
    paymentSourceType: z.enum(["Web3CardanoV1", "Web3CardanoV2"]),
    smartContractAddress: z.string().min(1).max(250),
    sellerReturnAddress: z.string().max(250).nullable(),
  })
  .openapi("MpsQuoteTerms");

export const createMpsQuoteSchema = z
  .object({
    idempotencyKey: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9:_-]+$/),
    payByTime: z.iso.datetime({ offset: true }),
    submitResultTime: z.iso.datetime({ offset: true }),
    unlockTime: z.iso.datetime({ offset: true }),
    externalDisputeUnlockTime: z.iso.datetime({ offset: true }),
  })
  .strict()
  .openapi("CreateMpsQuote");

export const approveMpsQuoteSchema = z
  .object({
    termsHash: z.string().regex(/^[0-9a-f]{64}$/),
    maxCredits: z
      .number()
      .positive()
      .max(922_337_203)
      .refine(
        (value) => Number(value.toFixed(10)) === value,
        "Credit ceiling must use at most 10 decimal places",
      ),
  })
  .strict()
  .openapi("ApproveMpsQuote");

export const taskMpsPaymentQuoteSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    coworkerId: z.string(),
    sellerBindingId: z.string(),
    billingOwnerId: z.string(),
    billingOrganizationId: z.string().nullable(),
    network: z.enum(["Preprod", "Mainnet"]),
    state: z.enum([
      "unresolved",
      "quoted",
      "approved",
      "revoked",
      "expired",
      "consumed",
    ]),
    inputHash: z.string(),
    termsHash: z.string().nullable(),
    terms: mpsQuoteTermsSchema.nullable(),
    quotedCredits: z.number().nullable(),
    maxCredits: z.number().nullable(),
    expiresAt: dateTimeSchema,
    approvedAt: dateTimeSchema.nullable(),
    revokedAt: dateTimeSchema.nullable(),
    consumedAt: dateTimeSchema.nullable(),
    paymentsEnabled: z.literal(false),
  })
  .openapi("TaskMpsPaymentQuote");
