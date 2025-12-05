import type { Organization } from "@sokosumi/database";
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
      organization: Organization,
    ): Promise<Stripe.Customer> {
      const customer = await stripe.customers.create(
        {
          name: organization.name,
          ...(organization.invoiceEmail && {
            email: organization.invoiceEmail,
          }),
          metadata: {
            organizationId: organization.id,
            organizationSlug: organization.slug,
            type: "organization",
          },
        },
        {
          idempotencyKey: `${organization.id}`,
        },
      );
      return customer;
    },
  };
})();
