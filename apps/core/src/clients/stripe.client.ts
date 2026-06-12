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

  async retrieveProduct(
    productId: string,
    requestOptions?: Stripe.RequestOptions,
  ): Promise<Stripe.Product> {
    return await stripe.products.retrieve(productId, {}, requestOptions);
  },

  async retrieveProductWithDefaultPrice(
    productId: string,
    requestOptions?: Stripe.RequestOptions,
  ): Promise<Stripe.Product> {
    return await stripe.products.retrieve(
      productId,
      { expand: ["default_price"] },
      requestOptions,
    );
  },

  async retrieveSubscriptionWithItems(
    subscriptionId: string,
    requestOptions?: Stripe.RequestOptions,
  ): Promise<Stripe.Subscription> {
    return await stripe.subscriptions.retrieve(
      subscriptionId,
      { expand: ["items"] },
      requestOptions,
    );
  },

  async updateSubscriptionItemQuantity(
    subscriptionId: string,
    itemId: string,
    quantity: number,
    requestOptions?: Stripe.RequestOptions,
  ): Promise<Stripe.Subscription> {
    return await stripe.subscriptions.update(
      subscriptionId,
      {
        items: [
          {
            id: itemId,
            quantity,
          },
        ],
        payment_behavior: "error_if_incomplete",
        proration_behavior: "always_invoice",
      },
      requestOptions,
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

  /**
   * Verify a Stripe webhook payload against the core endpoint's signing
   * secret and parse it into a typed event. Throws when the signature is
   * invalid or the payload is malformed.
   */
  async constructWebhookEvent(
    payload: string,
    signature: string,
  ): Promise<Stripe.Event> {
    return await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      getEnv().STRIPE_WEBHOOK_SECRET,
    );
  },
};
