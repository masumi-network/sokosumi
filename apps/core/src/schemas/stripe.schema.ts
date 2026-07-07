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

/**
 * Result of ensuring a Stripe customer exists for a billing entity.
 *
 * Unlike {@link stripeCustomerSchema}, `stripeCustomerId` is never null: the
 * endpoint either returns the already-provisioned customer id or creates the
 * Stripe customer and returns the new id.
 */
export const provisionedStripeCustomerSchema = z
  .object({
    stripeCustomerId: z
      .string()
      .openapi({ example: "cus_123", description: "Stripe customer id" }),
  })
  .openapi("ProvisionedStripeCustomer");

export type ProvisionedStripeCustomer = z.infer<
  typeof provisionedStripeCustomerSchema
>;

export const stripeCustomerBillingAddressSchema = z
  .object({
    line1: z.string().openapi({ example: "123 Main St" }),
    line2: z
      .string()
      .nullable()
      .openapi({ example: "Suite 4", description: "Optional second line" }),
    city: z.string().openapi({ example: "Berlin" }),
    state: z.string().nullable().openapi({
      example: "CA",
      description: "State or province when required",
    }),
    postalCode: z.string().openapi({ example: "10115" }),
    country: z.string().openapi({
      example: "DE",
      description:
        "ISO 3166-1 alpha-2 country code, or empty when not set on Stripe",
    }),
  })
  .refine(
    (address) =>
      address.line1.trim().length > 0 ||
      (address.line2?.trim().length ?? 0) > 0 ||
      address.city.trim().length > 0 ||
      (address.state?.trim().length ?? 0) > 0 ||
      address.postalCode.trim().length > 0 ||
      address.country.trim().length > 0,
    { message: "At least one address field must be set" },
  )
  .openapi("StripeCustomerBillingAddress");

export type StripeCustomerBillingAddress = z.infer<
  typeof stripeCustomerBillingAddressSchema
>;

export const stripeCustomerBillingTaxIdSchema = z
  .object({
    id: z.string().openapi({ example: "txi_123" }),
    type: z.string().openapi({ example: "eu_vat" }),
    value: z.string().openapi({ example: "DE123456789" }),
    country: z.string().nullable().openapi({ example: "DE" }),
    verificationStatus: z.string().nullable().openapi({ example: "verified" }),
  })
  .openapi("StripeCustomerBillingTaxId");

export type StripeCustomerBillingTaxId = z.infer<
  typeof stripeCustomerBillingTaxIdSchema
>;

export const stripeCustomerBillingDetailsSchema = z
  .object({
    stripeCustomerId: z
      .string()
      .nullable()
      .openapi({ example: "cus_123", description: "Stripe customer id" }),
    email: z.string().nullable().openapi({
      example: "billing@example.com",
      description: "Stripe customer email used for invoices",
    }),
    address: stripeCustomerBillingAddressSchema.nullable(),
    taxIds: z.array(stripeCustomerBillingTaxIdSchema),
  })
  .openapi("StripeCustomerBillingDetails");

export type StripeCustomerBillingDetails = z.infer<
  typeof stripeCustomerBillingDetailsSchema
>;

export const emptyStripeCustomerBillingDetails: StripeCustomerBillingDetails = {
  stripeCustomerId: null,
  email: null,
  address: null,
  taxIds: [],
};
