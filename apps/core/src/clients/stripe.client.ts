import Stripe from "stripe";

import { getEnv } from "@/config/env";

interface CreateOrganizationCustomerInput {
  invoiceEmail?: null | string;
  name: string;
  organizationId: string;
  slug: string;
}

interface CreateUserCustomerInput {
  email: string;
  name: string;
  userId: string;
}

const stripe = new Stripe(getEnv().STRIPE_SECRET_KEY, {
  maxNetworkRetries: 0,
});

function withIdempotencyKey(
  idempotencyKey: string,
  requestOptions?: Stripe.RequestOptions,
): Stripe.RequestOptions {
  return {
    ...requestOptions,
    idempotencyKey,
    maxNetworkRetries: requestOptions?.maxNetworkRetries ?? 0,
  };
}

export const stripeClient = {
  async createUserCustomer(
    user: CreateUserCustomerInput,
    requestOptions?: Stripe.RequestOptions,
  ): Promise<Stripe.Customer> {
    return await stripe.customers.create(
      {
        email: user.email,
        metadata: {
          customerType: "user",
          userId: user.userId,
        },
        name: user.name,
      },
      withIdempotencyKey(`user-${user.userId}`, requestOptions),
    );
  },

  async createOrganizationCustomer(
    organization: CreateOrganizationCustomerInput,
    requestOptions?: Stripe.RequestOptions,
  ): Promise<Stripe.Customer> {
    return await stripe.customers.create(
      {
        ...(organization.invoiceEmail
          ? { email: organization.invoiceEmail }
          : {}),
        metadata: {
          customerType: "organization",
          organizationId: organization.organizationId,
          organizationSlug: organization.slug,
        },
        name: organization.name,
      },
      withIdempotencyKey(
        `organization-${organization.organizationId}`,
        requestOptions,
      ),
    );
  },

  async updateSubscriptionCancelAtPeriodEnd(
    subscriptionId: string,
    cancelAtPeriodEnd: boolean,
    requestOptions?: Stripe.RequestOptions,
  ): Promise<Stripe.Subscription> {
    return await stripe.subscriptions.update(
      subscriptionId,
      {
        cancel_at_period_end: cancelAtPeriodEnd,
      },
      requestOptions,
    );
  },

  async updateCustomerEmail(
    customerId: string,
    email: string | null,
    requestOptions?: Stripe.RequestOptions,
  ): Promise<Stripe.Customer> {
    return await stripe.customers.update(
      customerId,
      {
        email: email ?? "",
      },
      requestOptions,
    );
  },
};
