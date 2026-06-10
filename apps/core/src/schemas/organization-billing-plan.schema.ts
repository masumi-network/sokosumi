import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

const selfServeBillingPlanSchema = z
  .object({
    mode: z.literal("self_serve"),
    plan: z.enum(["free", "starter", "standard", "pro"]),
    purchasedSeats: z.number().int(),
    subscriptionId: z.string().nullable(),
    cancelAtPeriodEnd: z.boolean(),
    periodEnd: dateTimeSchema.nullable(),
  })
  .openapi("SelfServeOrganizationBillingPlan");

const enterpriseBillingPlanSchema = z
  .object({
    mode: z.literal("enterprise_contract"),
    plan: z.literal("enterprise"),
    isConsumable: z.boolean(),
    purchasedSeats: z.number().int(),
    contractId: z.string(),
    endsAt: dateTimeSchema,
    activatedAt: dateTimeSchema,
    cancelAtPeriodEnd: z.literal(false),
    periodEnd: z.null(),
  })
  .openapi("EnterpriseOrganizationBillingPlan");

export const organizationBillingPlanSchema = z
  .discriminatedUnion("mode", [
    enterpriseBillingPlanSchema,
    selfServeBillingPlanSchema,
  ])
  .openapi("OrganizationBillingPlan");

export type OrganizationBillingPlanResponse = z.infer<
  typeof organizationBillingPlanSchema
>;
