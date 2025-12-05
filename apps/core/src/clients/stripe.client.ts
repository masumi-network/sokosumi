import Stripe from "stripe";

import { getEnv } from "@/config/env";

export const stripeClient = (() => {
  const stripe = new Stripe(getEnv().STRIPE_SECRET_KEY);

  return {
    async createUserCustomer(
      userId: string,
      name: string,
      email: string,
    ): Promise<Stripe.Customer> {
      const customer = await stripe.customers.create(
        {
          name,
          email,
          metadata: { userId, type: "user" },
        },
        {
          idempotencyKey: `${userId}`,
        },
      );
      return customer;
    },

    async createOrganizationCustomer(
      organizationId: string,
      name: string,
      invoiceEmail: string | null,
      slug: string,
    ): Promise<Stripe.Customer> {
      const customer = await stripe.customers.create(
        {
          name,
          ...(invoiceEmail && {
            email: invoiceEmail,
          }),
          metadata: {
            organizationId,
            organizationSlug: slug,
            type: "organization",
          },
        },
        {
          idempotencyKey: `${organizationId}`,
        },
      );
      return customer;
    },

    async updateCustomerEmail(
      customerId: string,
      email: string | null,
    ): Promise<Stripe.Customer> {
      return await stripe.customers.update(
        customerId,
        { email: email ?? undefined },
        { idempotencyKey: `${customerId}-${email ?? "null"}` },
      );
    },

    async deleteCustomer(customerId: string): Promise<void> {
      await stripe.customers.del(customerId);
    },
  };
})();
