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

    async getCouponById(couponId: string): Promise<Stripe.Coupon | null> {
      try {
        return await stripe.coupons.retrieve(couponId);
      } catch {
        return null;
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

    async getCreditTopUpPriceCatalog(): Promise<CreditTopUpPriceCatalog> {
      const prices = await Promise.all(
        CREDIT_TOPUP_LOOKUP_KEYS.map(async (lookupKey) => [
          lookupKey,
          await this.getPriceByLookupKey(lookupKey),
        ]),
      );

      return Object.fromEntries(prices) as CreditTopUpPriceCatalog;
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
  };
})();
