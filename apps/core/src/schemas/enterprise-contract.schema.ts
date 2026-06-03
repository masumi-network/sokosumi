import { z } from "@hono/zod-openapi";
import {
  MIN_ENTERPRISE_CREDITS_PER_MONTH,
  MIN_ENTERPRISE_PERIOD_COUNT,
} from "@sokosumi/database/helpers";

import { dateTimeSchema } from "@/helpers/datetime.js";
import {
  enterpriseContractPeriodStatusValues,
  enterpriseContractStatusValues,
} from "@/helpers/enterprise-contract-api.js";
import { errorResponseSchema } from "@/helpers/error.js";

export const enterpriseContractIdParamsSchema = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path" },
    example: "01960000-0000-7000-8000-000000000001",
  }),
});

export const enterpriseContractStatusSchema = z
  .enum(enterpriseContractStatusValues)
  .openapi("EnterpriseContractStatus");

export const enterpriseContractPeriodStatusSchema = z
  .enum(enterpriseContractPeriodStatusValues)
  .openapi("EnterpriseContractPeriodStatus");

export const enterpriseContractPeriodSchema = z
  .object({
    id: z.uuid(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    periodStart: dateTimeSchema,
    periodEnd: dateTimeSchema,
    creditsToGrant: z.number().openapi({
      description: "Monthly grant for this period (credits)",
      example: 60_000,
    }),
    purchasedSeats: z.number().int().min(1),
    status: enterpriseContractPeriodStatusSchema,
  })
  .openapi("EnterpriseContractPeriod");

export const enterpriseContractSchema = z
  .object({
    id: z.uuid(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    organizationId: z.string().openapi({ example: "org_123" }),
    status: enterpriseContractStatusSchema,
    startDate: dateTimeSchema.nullable(),
    periods: z.number().int().min(MIN_ENTERPRISE_PERIOD_COUNT).openapi({
      description: "Commercial term length in monthly grant periods",
      example: 12,
    }),
    activatedAt: dateTimeSchema.nullable(),
    canceledAt: dateTimeSchema.nullable(),
    seats: z.number().int().min(1),
    creditsPerMonth: z.number().openapi({
      description: "Monthly shared pool grant (credits)",
      example: MIN_ENTERPRISE_CREDITS_PER_MONTH,
    }),
    oneTimeCredits: z.number().nullable().openapi({
      description: "Optional lump-sum org grant on activation (credits)",
    }),
    oneTimeExpiresAt: dateTimeSchema.nullable(),
    paymentReference: z.string().nullable(),
    notes: z.string().nullable(),
    externalReference: z.string().nullable(),
    contractEnd: dateTimeSchema.nullable().openapi({
      description:
        "Derived end of the commercial term (not stored on the contract)",
    }),
    contractPeriods: z
      .array(enterpriseContractPeriodSchema)
      .optional()
      .openapi({
        description: "Materialized periods (detail responses only)",
      }),
  })
  .openapi("EnterpriseContract");

export type EnterpriseContractResponse = z.infer<
  typeof enterpriseContractSchema
>;

export const createEnterpriseContractRequestSchema = z
  .object({
    organizationId: z.string().min(1).openapi({ example: "org_123" }),
    creditsPerMonth: z.number().openapi({
      example: MIN_ENTERPRISE_CREDITS_PER_MONTH,
      description: `Minimum ${MIN_ENTERPRISE_CREDITS_PER_MONTH} credits`,
    }),
    periods: z.number().int().min(MIN_ENTERPRISE_PERIOD_COUNT).openapi({
      example: 12,
      description: "Number of full monthly grant periods",
    }),
    seats: z.number().int().min(1).openapi({ example: 10 }),
    startDate: dateTimeSchema.optional().openapi({
      description: "Earliest date the contract may begin after activation",
    }),
    oneTimeCredits: z.number().min(0).optional(),
    oneTimeExpiresAt: dateTimeSchema.optional(),
    paymentReference: z.string().optional(),
    notes: z.string().optional(),
    externalReference: z.string().optional(),
  })
  .openapi("CreateEnterpriseContractRequest");

export const patchEnterpriseContractRequestSchema = z
  .object({
    creditsPerMonth: z.number().optional(),
    periods: z.number().int().min(MIN_ENTERPRISE_PERIOD_COUNT).optional(),
    seats: z.number().int().min(1).optional(),
    startDate: dateTimeSchema.nullable().optional(),
    oneTimeCredits: z.number().min(0).nullable().optional(),
    oneTimeExpiresAt: dateTimeSchema.nullable().optional(),
    paymentReference: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    externalReference: z.string().nullable().optional(),
  })
  .openapi("PatchEnterpriseContractRequest");

export const listEnterpriseContractsQuerySchema = z.object({
  organizationId: z
    .string()
    .optional()
    .openapi({
      param: { name: "organizationId", in: "query" },
      example: "org_123",
    }),
  status: enterpriseContractStatusSchema.optional().openapi({
    param: { name: "status", in: "query" },
  }),
});

export const activateEnterpriseContractRequestSchema = z
  .object({
    paymentReference: z.string().min(1).optional(),
  })
  .openapi("ActivateEnterpriseContractRequest");

export const enterpriseContractPreviewPeriodSchema = z
  .object({
    periodStart: dateTimeSchema,
    periodEnd: dateTimeSchema,
    creditsToGrant: z.number(),
    purchasedSeats: z.number().int().min(1),
  })
  .openapi("EnterpriseContractPreviewPeriod");

export const enterpriseContractPreviewSchema = z
  .object({
    activatedAt: dateTimeSchema,
    startDate: dateTimeSchema,
    contractEnd: dateTimeSchema,
    periods: z.array(enterpriseContractPreviewPeriodSchema),
  })
  .openapi("EnterpriseContractPreview");

export const enterpriseContractPreviewQuerySchema = z.object({
  activatedAt: dateTimeSchema.openapi({
    param: { name: "activatedAt", in: "query" },
    description:
      "Hypothetical activation timestamp (required; do not rely on server now)",
  }),
});

export const enterpriseContractActivationBlockerSchema = z
  .object({
    subscriptionId: z.string(),
    stripeSubscriptionId: z.string(),
    referenceId: z.string(),
    plan: z.string(),
    scope: z.enum(["member", "organization"]),
    userId: z.string().optional(),
  })
  .openapi("EnterpriseContractActivationBlocker");

export const enterpriseContractActivationConflictResponseSchema =
  errorResponseSchema
    .extend({
      blockers: z.array(enterpriseContractActivationBlockerSchema),
    })
    .openapi("EnterpriseContractActivationConflictResponse");

export const activateEnterpriseContractResponseSchema = z
  .object({
    contractId: z.uuid(),
    periodBucketCreated: z.boolean(),
    periodsCreated: z.number().int(),
    topUpBucketCreated: z.boolean(),
  })
  .openapi("ActivateEnterpriseContractResponse");
