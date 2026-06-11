import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

/**
 * Resolved billing plan for an organization.
 *
 * Flattened view of the database billing-plan resolution: `mode` distinguishes
 * an active enterprise contract from self-serve (Stripe subscription) billing.
 * `isConsumable` is only meaningful for `enterprise_contract` (always `false`
 * for `self_serve`); `periodEnd` is only set for self-serve subscriptions.
 */
export const organizationBillingPlanSchema = z
  .object({
    mode: z.enum(["enterprise_contract", "self_serve"]).openapi({
      description:
        "Billing mode: active enterprise contract or self-serve subscription",
      example: "self_serve",
    }),
    plan: z.enum(["free", "starter", "standard", "pro", "enterprise"]).openapi({
      description: "Resolved billing plan name",
      example: "starter",
    }),
    isConsumable: z.boolean().openapi({
      description:
        "Whether the enterprise contract is still within its consumable term (always false for self-serve)",
      example: false,
    }),
    purchasedSeats: z.number().int().openapi({
      description: "Number of purchased seats",
      example: 3,
    }),
    cancelAtPeriodEnd: z.boolean().openapi({
      description:
        "Whether the self-serve subscription cancels at the period end (always false for enterprise contracts)",
      example: false,
    }),
    periodEnd: dateTimeSchema.nullable().openapi({
      description:
        "End of the current self-serve billing period (null for enterprise contracts or when unknown)",
    }),
  })
  .openapi("OrganizationBillingPlan");

export type OrganizationBillingPlanApi = z.infer<
  typeof organizationBillingPlanSchema
>;
