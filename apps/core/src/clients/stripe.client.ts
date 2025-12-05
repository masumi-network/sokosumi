import type { Organization, User } from "@sokosumi/database";
import Stripe from "stripe";

import { getEnv } from "@/config/env";

export const stripeClient = (() => {
  const stripe = new Stripe(getEnv().STRIPE_SECRET_KEY);

  return {
    async createUserCustomer(user: User): Promise<Stripe.Customer> {
      const customer = await stripe.customers.create(
        {
          name: user.name,
          email: user.email,
          metadata: { userId: user.id, type: "user" },
        },
        {
          idempotencyKey: `${user.id}`,
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
