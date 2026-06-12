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

export interface CreditPrice {
  id: string;
  amountPerCredit: number;
  currency: string;
}

const stripe = new Stripe(getEnv().STRIPE_SECRET_KEY, {
  maxNetworkRetries: 0,
});

// Mirrors the web stripe client's credit-price selection
// (`apps/web/src/lib/clients/stripe.client.ts`).
const MAX_REFERRAL_COUNT = 4; // max number of referral credits to apply
const SUPPORTED_CREDIT_PRICE_CURRENCIES = ["eur", "usd"] as const;
const SUPPORTED_CREDIT_PRICE_CURRENCY_SET = new Set<string>(
  SUPPORTED_CREDIT_PRICE_CURRENCIES,
);

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

function isSupportedCreditPriceCurrency(currency: string): boolean {
  return SUPPORTED_CREDIT_PRICE_CURRENCY_SET.has(currency);
}

function getStripeUnitAmount(price: Stripe.Price): number | null {
  if (price.unit_amount_decimal !== null) {
    const decimalAmount = Number(price.unit_amount_decimal);
    return Number.isFinite(decimalAmount) ? decimalAmount : null;
  }

  if (price.unit_amount !== null) {
    return price.unit_amount;
  }

  return null;
}

function isValidCreditPrice(price: Stripe.Price): boolean {
  const amountPerCredit = getStripeUnitAmount(price);
  return (
    isSupportedCreditPriceCurrency(price.currency) &&
    amountPerCredit !== null &&
    amountPerCredit > 0
  );
}

function selectPreferredCreditPrice(
  prices: Stripe.Price[],
): Stripe.Price | null {
  for (const currency of SUPPORTED_CREDIT_PRICE_CURRENCIES) {
    const matchedPrice = prices.find(
      (price) => price.currency === currency && isValidCreditPrice(price),
    );
    if (matchedPrice) {
      return matchedPrice;
    }
  }

  return null;
}

function validatePrice(price: Stripe.Price): CreditPrice {
  const amountPerCredit = getStripeUnitAmount(price);

  if (!isSupportedCreditPriceCurrency(price.currency)) {
    throw new Error(`Unsupported credit price currency: ${price.currency}`);
  }
  if (amountPerCredit === null) {
    throw new Error("Price unit_amount and unit_amount_decimal are invalid");
  }
  if (amountPerCredit <= 0) {
    throw new Error(
      "Price unit_amount is 0 (free product) – cannot use for credit purchase",
    );
  }
  return {
    id: price.id,
    amountPerCredit,
    currency: price.currency,
  };
}

function getCreditsForCoupon(coupon: Stripe.Coupon): number {
  if (!coupon.percent_off) {
    throw new Error("Coupon must have percent_off");
  }

  const creditsRaw = coupon.metadata?.credits;
  if (!creditsRaw) {
    throw new Error(
      "Coupon metadata must include credits as a positive integer",
    );
  }

  const credits = Number(creditsRaw);
  if (!Number.isFinite(credits) || !Number.isInteger(credits) || credits <= 0) {
    throw new Error("Coupon metadata credits must be a positive integer");
  }
  return credits;
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

  async getCouponById(couponId: string): Promise<Stripe.Coupon | null> {
    try {
      return await stripe.coupons.retrieve(couponId);
    } catch {
      return null;
    }
  },

  async getPriceByProductId(productId: string): Promise<CreditPrice> {
    try {
      const product = await stripe.products.retrieve(productId, {
        expand: ["default_price"],
      });

      if (
        typeof product.default_price === "object" &&
        product.default_price !== null &&
        isValidCreditPrice(product.default_price)
      ) {
        return validatePrice(product.default_price);
      }

      const productPrices = await stripe.prices.list({
        product: productId,
        active: true,
        limit: 100,
      });
      const fallbackPrice = selectPreferredCreditPrice(productPrices.data);
      if (!fallbackPrice) {
        throw new Error(
          `No valid credit price found for product ${productId}. Expected currencies: ${SUPPORTED_CREDIT_PRICE_CURRENCIES.join(", ")}`,
        );
      }

      return validatePrice(fallbackPrice);
    } catch (error) {
      console.error("Error retrieving price", error);
      throw error;
    }
  },

  /**
   * Grants free credits by creating discounted invoice items and a
   * zero-total invoice. Port of the web stripe client's method — the derived
   * idempotency keys and request params MUST stay identical so a
   * `customer.created` redelivery that already ran through the web handler
   * replays the original grant instead of failing or double-granting.
   *
   * `idempotencyKeyBase` makes the whole grant idempotent against retries:
   * every Stripe call derives its own key from the base (`-item-N`,
   * `-invoice`, `-finalize`). The base MUST be stable across retries of the
   * same logical grant and unique per legitimately distinct grant — derive it
   * from domain identifiers, never from timestamps or randomness.
   */
  async applyInvoiceCreditsToCustomer(
    customerId: string,
    couponId: string,
    idempotencyKeyBase: string,
    metadata?: Record<string, string>,
    referralCount: number = 1,
  ): Promise<Stripe.Invoice> {
    const productId = getEnv().STRIPE_CREDIT_PRODUCT_ID;
    const price = await this.getPriceByProductId(productId);

    const coupon = await stripe.coupons.retrieve(couponId);
    if (!coupon) throw new Error("Coupon not found");
    if (!coupon.percent_off) {
      throw new Error("Coupon must have percent_off");
    }
    const credits = getCreditsForCoupon(coupon);
    const couponTtlDays = coupon.metadata?.ttl_days;

    // 1) Add invoice items representing the free credits
    const itemsToCreate = Math.min(referralCount, MAX_REFERRAL_COUNT);
    await Promise.all(
      Array.from({ length: itemsToCreate }).map((_, index) =>
        stripe.invoiceItems.create(
          {
            customer: customerId,
            pricing: { price: price.id },
            currency: price.currency,
            quantity: credits,
            description: `Referral credit redemption (${credits} credits) - ${index + 1} of ${itemsToCreate}`,
            metadata: {
              coupon_id: couponId,
              redemption_type: "free_coupon",
              ...(couponTtlDays ? { ttl_days: couponTtlDays } : {}),
              ...(metadata ?? {}),
            },
            discounts: [{ coupon: couponId }],
          },
          {
            idempotencyKey: `${idempotencyKeyBase}-item-${index + 1}`,
          },
        ),
      ),
    );

    // 2) Create & finalize zero-total invoice with the coupon discount
    const invoice = await stripe.invoices.create(
      {
        customer: customerId,
        currency: price.currency,
        pending_invoice_items_behavior: "include",
        collection_method: "charge_automatically",
        auto_advance: true,
        metadata: {
          coupon_id: couponId,
          price_id: price.id,
          ...(couponTtlDays ? { ttl_days: couponTtlDays } : {}),
          ...(metadata ?? {}),
        },
        expand: ["lines.data.price.product"],
      },
      {
        idempotencyKey: `${idempotencyKeyBase}-invoice`,
      },
    );

    if (!invoice.id) {
      throw new Error("Failed to create credit invoice");
    }

    const finalizedInvoice = await stripe.invoices.finalizeInvoice(
      invoice.id,
      {},
      {
        idempotencyKey: `${idempotencyKeyBase}-finalize`,
      },
    );

    return finalizedInvoice;
  },
};
