import { z } from "@hono/zod-openapi";

/**
 * Stripe customer id for a billing entity (a user or an organization).
 *
 * `stripeCustomerId` is `null` when the entity exists but has never had a Stripe
 * customer provisioned yet. The endpoints that return this resolve the entity
 * first (404 when it does not exist), so a 200 with `null` here is meaningful.
 */
export const stripeCustomerSchema = z
  .object({
    stripeCustomerId: z
      .string()
      .nullable()
      .openapi({ example: "cus_123", description: "Stripe customer id" }),
  })
  .openapi("StripeCustomer");

export type StripeCustomer = z.infer<typeof stripeCustomerSchema>;
