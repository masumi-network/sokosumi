import "server-only";

import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import {
  BASE_CREDIT_TOPUP_LOOKUP_KEY,
  CREDIT_TOPUP_LOOKUP_KEYS,
  type CreditTopUpLookupKey,
  getCreditTopUpLookupKeyByCredits,
  getCreditTopUpTotalMinorUnits,
  type StandardCreditTopUpLookupKey,
} from "@/lib/stripe/credit-topup-pricing";

export interface Price {
  id: string;
  amountPerCredit: number;
  currency: string;
}

export type CreditTopUpPriceCatalog = Record<
  StandardCreditTopUpLookupKey,
  Price
> &
  Partial<Record<CreditTopUpLookupKey, Price>>;

export const stripeClient = (() => {
  const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);
  let cachedStripeAccountId: string | null = null;
  const SUPPORTED_CREDIT_PRICE_CURRENCIES = ["eur", "usd"] as const;
  const SUPPORTED_CREDIT_PRICE_CURRENCY_SET = new Set<string>(
    SUPPORTED_CREDIT_PRICE_CURRENCIES,
  );

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

  function validatePrice(price: Stripe.Price): Price {
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

  function normalizeCheckoutReturnPath(returnPath: string): string {
    if (!returnPath) {
      return "/billing?tab=credits";
    }

    return returnPath.startsWith("/") ? returnPath : `/${returnPath}`;
  }

  function buildCheckoutReturnUrl(
    checkoutBaseUrl: string,
    returnPath: string,
    searchParams: Record<string, string>,
  ): string {
    const normalizedReturnPath = normalizeCheckoutReturnPath(returnPath);
    const querySuffix = Object.entries(searchParams)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    const querySeparator = normalizedReturnPath.includes("?") ? "&" : "?";

    return `${checkoutBaseUrl}${normalizedReturnPath}${querySeparator}${querySuffix}`;
  }

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
          metadata: { userId, customerType: "user" },
        },
        {
          idempotencyKey: `user-${userId}`,
        },
      );
      return customer;
    },

    async createOrganizationCustomer(
      organizationId: string,
      slug: string,
      name: string,
      invoiceEmail?: string | null,
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
            customerType: "organization",
          },
        },
        {
          idempotencyKey: `organization-${organizationId}`,
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
        {
          email: email ?? undefined,
        },
        {
          idempotencyKey: `${customerId}-${email ?? "null"}`,
        },
      );
    },

    async listSubscriptions(
      customerId: string,
    ): Promise<Stripe.Subscription[]> {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });
      return subscriptions.data;
    },

    async createSubscription(
      customerId: string,
      priceId: string,
      quantity: number,
      metadata: {
        organizationId?: string;
        referenceId: string;
        userId?: string;
      },
      idempotencyKey?: string,
    ): Promise<Stripe.Subscription> {
      return await stripe.subscriptions.create(
        {
          customer: customerId,
          items: [
            {
              price: priceId,
              ...(quantity > 0 ? { quantity } : {}),
            },
          ],
          metadata: {
            referenceId: metadata.referenceId,
            ...(metadata.userId ? { userId: metadata.userId } : {}),
            ...(metadata.organizationId
              ? { organizationId: metadata.organizationId }
              : {}),
          },
        },
        {
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
      );
    },

    async deleteCustomer(customerId: string): Promise<void> {
      await stripe.customers.del(customerId);
    },

    async getPromotionCode(
      customerId: string,
      couponId: string,
    ): Promise<Stripe.PromotionCode | null> {
      const promotionCodes = await stripe.promotionCodes.list({
        coupon: couponId,
        customer: customerId,
        limit: 1,
      });

      if (promotionCodes.data.length === 0) {
        return null;
      }

      return promotionCodes.data[0];
    },

    async createPromotionCode(
      customerId: string,
      couponId: string,
      maxRedemptions: number = 1,
      metadata?: Record<string, string>,
    ): Promise<Stripe.PromotionCode | null> {
      const promotionCode = await stripe.promotionCodes.create(
        {
          customer: customerId,
          promotion: {
            coupon: couponId,
            type: "coupon",
          },
          max_redemptions: maxRedemptions,
          metadata,
        },
        {
          idempotencyKey: `${customerId}-${couponId}`,
        },
      );
      return promotionCode;
    },

    async getCouponByPromotionCode(
      code: string,
    ): Promise<Stripe.Coupon | null> {
      try {
        const promotionCode = await stripe.promotionCodes.retrieve(code);
        const promotion = promotionCode.promotion;
        if (!promotion) {
          return null;
        }
        if (!promotion.coupon) {
          return null;
        }
        if (promotion.type !== "coupon") {
          return null;
        }
        return promotionCode.promotion.coupon as Stripe.Coupon;
      } catch {
        return null;
      }
    },

    async getCouponById(couponId: string): Promise<Stripe.Coupon | null> {
      try {
        return await stripe.coupons.retrieve(couponId);
      } catch {
        return null;
      }
    },

    async getPriceById(priceId: string): Promise<Price> {
      try {
        const price = await stripe.prices.retrieve(priceId);
        return validatePrice(price);
      } catch (error) {
        console.error("Error retrieving price", error);
        throw error;
      }
    },

    async getPriceByLookupKey(lookupKey: CreditTopUpLookupKey): Promise<Price> {
      try {
        const matchingPrices = await stripe.prices.list({
          lookup_keys: [lookupKey],
          product: getEnvSecrets().STRIPE_CREDIT_PRODUCT_ID,
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

    async getCreditTopUpPriceByCredits(
      credits: number,
      lookupKeyOverride?: CreditTopUpLookupKey,
    ): Promise<Price> {
      const lookupKey = getCreditTopUpLookupKeyByCredits(
        credits,
        lookupKeyOverride,
      );
      return await this.getPriceByLookupKey(lookupKey);
    },

    async getBaseCreditTopUpPrice(): Promise<Price> {
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
      Array<Price & { nickname: string | null }>
    > {
      const productId = getEnvSecrets().STRIPE_CREDIT_PRODUCT_ID;
      const prices = await stripe.prices.list({
        product: productId,
        active: true,
        limit: 100,
      });

      return prices.data
        .filter(
          (price) => price.recurring === null && isValidCreditPrice(price),
        )
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
    async getCreditTopUpPriceById(priceId: string): Promise<Price> {
      const price = await stripe.prices.retrieve(priceId);
      const productId =
        typeof price.product === "string" ? price.product : price.product?.id;
      if (productId !== getEnvSecrets().STRIPE_CREDIT_PRODUCT_ID) {
        throw new Error("Price does not belong to the credit product");
      }
      return validatePrice(price);
    },

    async getCreditTopUpPriceCatalog(): Promise<CreditTopUpPriceCatalog> {
      const prices = await Promise.all(
        CREDIT_TOPUP_LOOKUP_KEYS.map(async (lookupKey) => [
          lookupKey,
          await this.getPriceByLookupKey(lookupKey),
        ]),
      );

      return Object.fromEntries(prices) as CreditTopUpPriceCatalog;
    },

    async constructEvent(req: Request, stripeSignature: string) {
      return stripe.webhooks.constructEvent(
        await req.text(),
        stripeSignature,
        getEnvSecrets().STRIPE_WEBHOOK_SECRET,
      );
    },

    async getInvoice(invoiceId: string): Promise<Stripe.Invoice> {
      return await stripe.invoices.retrieve(invoiceId, {
        expand: ["lines.data.price.product"],
      });
    },

    /**
     * Searches invoices with the customer expanded, using Stripe's invoice
     * search query language. Search filters server-side on metadata, status,
     * and customer — unlike `invoices.list`, which can only filter by a single
     * status and ignores metadata — so the admin invoice list reliably
     * returns grant invoices instead of having them crowded out of the most
     * recent page by unrelated checkout/subscription invoices.
     *
     * Paginates through all matches up to `maxResults` because Stripe's search
     * API does not guarantee an ordering (unlike `invoices.list`, which is
     * newest-first). Callers that need "most recent first" must therefore
     * gather every match and sort themselves rather than trusting the first
     * page to hold the newest results.
     *
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

    async getCheckoutSession(
      sessionId: string,
    ): Promise<Stripe.Checkout.Session> {
      return await stripe.checkout.sessions.retrieve(sessionId, {
        expand: [
          "line_items",
          "line_items.data.price.product",
          "discounts.coupon",
        ],
      });
    },

    async createCheckoutSession(
      stripeCustomerId: string,
      userId: string,
      organizationId: string | null,
      credits: number,
      price: Price,
      origin: string | null = null,
      promotionCode: string | null = null,
      returnPath: string = "/billing?tab=credits",
      ttlDays?: string,
    ): Promise<Stripe.Checkout.Session> {
      if (price.amountPerCredit === 0) {
        throw new Error(
          "Price amountPerCredit is 0 – cannot create checkout session for free product",
        );
      }
      const env = getEnvSecrets();
      const checkoutUnitAmount = getCreditTopUpTotalMinorUnits(
        credits,
        price.amountPerCredit,
      );
      const creditsLabel = credits.toLocaleString("en-US");
      const checkoutBaseUrl = (
        origin ??
        env.VERCEL_URL ??
        "https://sokosumi.com"
      ).replace(/\/$/, "");
      const checkoutCreditsMessage = `${creditsLabel} credits will be added to your account after checkout.`;
      const sessionMetadata = {
        credits,
        userId,
        ...(organizationId && { organizationId }),
        ...(ttlDays ? { ttl_days: ttlDays } : {}),
      };
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: price.currency,
              product: env.STRIPE_CREDIT_PRODUCT_ID,
              unit_amount: checkoutUnitAmount,
            },
            quantity: 1,
          },
        ],
        customer: stripeCustomerId,
        customer_update: {
          address: "auto",
          name: "auto",
        },
        metadata: sessionMetadata,
        invoice_creation: {
          enabled: true,
          invoice_data: {
            metadata: sessionMetadata,
          },
        },
        billing_address_collection: "required",
        tax_id_collection: { enabled: true },
        custom_text: {
          submit: {
            message: checkoutCreditsMessage,
          },
        },
        success_url: buildCheckoutReturnUrl(checkoutBaseUrl, returnPath, {
          session_id: "{CHECKOUT_SESSION_ID}",
        }),
        cancel_url: buildCheckoutReturnUrl(checkoutBaseUrl, returnPath, {
          cancel: "true",
        }),
      };

      if (promotionCode) {
        sessionParams.discounts = [{ promotion_code: promotionCode }];
      } else {
        sessionParams.allow_promotion_codes = false;
      }

      const session = await stripe.checkout.sessions.create(sessionParams);
      return session;
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
})();
