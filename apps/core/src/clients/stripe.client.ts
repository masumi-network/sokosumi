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
const BASE_CREDIT_TOPUP_LOOKUP_KEY = "credit_20_margin";
/** Known credit top-up lookup keys; widen this union as more keys move to core. */
type CreditTopUpLookupKey = typeof BASE_CREDIT_TOPUP_LOOKUP_KEY;
let cachedStripeAccountId: string | null = null;
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

  async updateCustomerEmail(
    customerId: string,
    email: string | null,
    requestOptions?: Stripe.RequestOptions,
  ): Promise<Stripe.Customer> {
    return await stripe.customers.update(
      customerId,
      {
        email: email ?? undefined,
      },
      {
        ...requestOptions,
        idempotencyKey: `${customerId}-${email ?? "null"}`,
        maxNetworkRetries: requestOptions?.maxNetworkRetries ?? 0,
      },
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

  async getPriceByLookupKey(
    lookupKey: CreditTopUpLookupKey,
  ): Promise<CreditPrice> {
    try {
      const matchingPrices = await stripe.prices.list({
        lookup_keys: [lookupKey],
        product: getEnv().STRIPE_CREDIT_PRODUCT_ID,
        active: true,
        limit: 100,
      });
      const matchedPrice = selectPreferredCreditPrice(matchingPrices.data);
      if (!matchedPrice) {
        throw new Error(
          `No valid credit price found for lookup key ${lookupKey}. Expected currencies: ${SUPPORTED_CREDIT_PRICE_CURRENCIES.join(", ")}`,
        );
      }

      return validatePrice(matchedPrice);
    } catch (error) {
      console.error("Error retrieving price by lookup key", error);
      throw error;
    }
  },

  async getBaseCreditTopUpPrice(): Promise<CreditPrice> {
    return await this.getPriceByLookupKey(BASE_CREDIT_TOPUP_LOOKUP_KEY);
  },

  /**
   * Returns the Stripe account id the configured API key belongs to (the
   * sandbox account id when running against a sandbox key). Cached for the
   * lifetime of the process. Used to build account-scoped dashboard links
   * that resolve to the correct sandbox/live account.
   */
  async getAccountId(): Promise<string> {
    if (cachedStripeAccountId) {
      return cachedStripeAccountId;
    }
    // GET /v1/account — the account the configured API key belongs to.
    const account = await stripe.accounts.retrieveCurrent();
    cachedStripeAccountId = account.id;
    return cachedStripeAccountId;
  },

  /**
   * Lists all active one-time prices configured on the credit product, for
   * admin selection. Invalid prices (unsupported currency, zero amount,
   * recurring) are skipped. Sorted by currency, then amount per credit.
   */
  async listCreditTopUpPrices(): Promise<
    Array<CreditPrice & { nickname: string | null }>
  > {
    const productId = getEnv().STRIPE_CREDIT_PRODUCT_ID;
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 100,
    });

    return prices.data
      .filter((price) => price.recurring === null && isValidCreditPrice(price))
      .map((price) => ({
        ...validatePrice(price),
        nickname: price.nickname ?? null,
      }))
      .sort((a, b) =>
        a.currency === b.currency
          ? a.amountPerCredit - b.amountPerCredit
          : a.currency.localeCompare(b.currency),
      );
  },

  /**
   * Retrieves a single price by id and verifies it belongs to the credit
   * product before validating it. Throws otherwise.
   */
  async getCreditTopUpPriceById(priceId: string): Promise<CreditPrice> {
    const price = await stripe.prices.retrieve(priceId);
    const productId =
      typeof price.product === "string" ? price.product : price.product?.id;
    if (productId !== getEnv().STRIPE_CREDIT_PRODUCT_ID) {
      throw new Error("Price does not belong to the credit product");
    }
    return validatePrice(price);
  },

  async getInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    return await stripe.invoices.retrieve(invoiceId, {
      expand: ["lines.data.price.product"],
    });
  },

  /**
   * Searches invoices with the customer expanded, using Stripe's invoice
   * search query language. Paginates through all matches up to `maxResults`
   * because Stripe's search API does not guarantee an ordering — callers that
   * need "most recent first" must gather every match and sort themselves.
   * Note: Stripe's search index is eventually consistent, so an invoice
   * created moments ago may take a short while to appear.
   */
  async searchInvoices(params: {
    query: string;
    maxResults?: number;
  }): Promise<Stripe.Invoice[]> {
    const maxResults = params.maxResults ?? 100;
    const invoices: Stripe.Invoice[] = [];
    let page: string | undefined;

    do {
      const result = await stripe.invoices.search({
        query: params.query,
        limit: 100,
        expand: ["data.customer"],
        ...(page ? { page } : {}),
      });
      invoices.push(...result.data);
      page = result.has_more ? (result.next_page ?? undefined) : undefined;
    } while (page && invoices.length < maxResults);

    return invoices;
  },

  /**
   * Creates and finalizes a one-time admin invoice for a customer.
   *
   * The invoice is tagged with the `credits` (and optional `ttl_days`)
   * metadata that the invoice-paid automation reads to grant credits. It is
   * created with `collection_method: "send_invoice"` so that finalizing it
   * does not attempt to auto-charge a payment method; the invoice can then
   * either be marked paid directly (see {@link payInvoiceOutOfBand}) or paid
   * through the normal Stripe flow.
   */
  async createAdminInvoice(params: {
    customerId: string;
    credits: number;
    /** Credit-product price the line item is billed against. Tying the item to
     * the product (rather than a raw amount) lets a product-scoped coupon
     * apply. */
    priceId: string;
    currency: string;
    ttlDays?: number;
    daysUntilDue?: number;
    description?: string;
    /** When set, applies this coupon as a discount on the credit line
     * item. A 100%-off coupon makes the grant free ($0 due). */
    couponId?: string;
  }): Promise<Stripe.Invoice> {
    const metadata: Record<string, string> = {
      credits: String(params.credits),
      grant_source: "admin_one_time_credit",
      ...(params.ttlDays ? { ttl_days: String(params.ttlDays) } : {}),
    };

    // Create the (empty) invoice first, then attach the line item to *this*
    // invoice rather than leaving a pending customer item. That way a failure
    // before finalize can't orphan a pending item that later rolls into the
    // next grant invoice for the same customer.
    const invoice = await stripe.invoices.create({
      customer: params.customerId,
      currency: params.currency,
      collection_method: "send_invoice",
      days_until_due: params.daysUntilDue ?? 30,
      auto_advance: false,
      metadata,
    });

    if (!invoice.id) {
      throw new Error("Failed to create admin invoice");
    }

    // Bill the line item against the credit product's price (not a raw
    // amount) and discount the item itself. A product-scoped coupon only
    // applies to a line tied to that product; an invoice-level discount or a
    // raw-amount line leaves a 100%-off coupon with a €0 effect.
    await stripe.invoiceItems.create({
      customer: params.customerId,
      invoice: invoice.id,
      pricing: { price: params.priceId },
      currency: params.currency,
      quantity: params.credits,
      description:
        params.description ??
        `One-time credit invoice (${params.credits.toLocaleString("en-US")} credits)`,
      ...(params.couponId ? { discounts: [{ coupon: params.couponId }] } : {}),
      metadata,
    });

    return await stripe.invoices.finalizeInvoice(invoice.id, {
      expand: ["lines.data.price.product"],
    });
  },

  /**
   * Marks an invoice as paid out of band (i.e. payment recorded outside of
   * Stripe). Returns the updated invoice with line items expanded so callers
   * can run the invoice-paid automation directly.
   */
  async payInvoiceOutOfBand(invoiceId: string): Promise<Stripe.Invoice> {
    return await stripe.invoices.pay(invoiceId, {
      paid_out_of_band: true,
      expand: ["lines.data.price.product"],
    });
  },
};
