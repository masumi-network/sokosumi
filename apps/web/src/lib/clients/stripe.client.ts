import "server-only";

import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { getCreditsForCoupon } from "@/lib/utils/credits";

export interface Price {
  id: string;
  amountPerCredit: number;
  currency: string;
}

export const stripeClient = (() => {
  const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);
  const MAX_REFERRAL_COUNT = 4; // max number of referral credits to apply
  const SUPPORTED_CREDIT_PRICE_CURRENCIES = ["eur", "usd"] as const;
  const SUPPORTED_CREDIT_PRICE_CURRENCY_SET = new Set<string>(
    SUPPORTED_CREDIT_PRICE_CURRENCIES,
  );

  function isSupportedCreditPriceCurrency(currency: string): boolean {
    return SUPPORTED_CREDIT_PRICE_CURRENCY_SET.has(currency);
  }

  function isValidCreditPrice(price: Stripe.Price): boolean {
    return (
      isSupportedCreditPriceCurrency(price.currency) &&
      price.unit_amount !== null &&
      price.unit_amount > 0
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
    if (!isSupportedCreditPriceCurrency(price.currency)) {
      throw new Error(`Unsupported credit price currency: ${price.currency}`);
    }
    if (price.unit_amount === null) {
      throw new Error("Price unit_amount is null");
    }
    if (price.unit_amount === 0) {
      throw new Error(
        "Price unit_amount is 0 (free product) – cannot use for credit purchase",
      );
    }
    return {
      id: price.id,
      amountPerCredit: price.unit_amount!,
      currency: price.currency,
    };
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
      metadata: { referenceId: string; userId: string },
      idempotencyKey?: string,
    ): Promise<Stripe.Subscription> {
      return await stripe.subscriptions.create(
        {
          customer: customerId,
          items: [{ price: priceId }],
          metadata: {
            referenceId: metadata.referenceId,
            userId: metadata.userId,
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

    async getPriceByProductId(productId: string): Promise<Price> {
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
    ): Promise<Stripe.Checkout.Session> {
      // Prevent division by zero for price.unit_amount
      if (price.amountPerCredit === 0) {
        throw new Error(
          "Price amountPerCredit is 0 – cannot create checkout session for free product",
        );
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price: price.id,
            quantity: credits,
          },
        ],
        ...(promotionCode
          ? { discounts: [{ promotion_code: promotionCode }] }
          : { allow_promotion_codes: false }),
        customer: stripeCustomerId,
        customer_update: {
          address: "auto",
          name: "auto",
        },
        metadata: {
          credits,
          userId,
          ...(organizationId && { organizationId }),
        },
        invoice_creation: {
          enabled: true,
          invoice_data: {
            metadata: {
              credits,
              userId,
              ...(organizationId && { organizationId }),
            },
          },
        },
        billing_address_collection: "required",
        tax_id_collection: { enabled: true },
        success_url: `${origin ?? getEnvSecrets().VERCEL_URL}/credits?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin ?? getEnvSecrets().VERCEL_URL}/credits?cancel=true`,
      });
      return session;
    },

    async applyInvoiceCreditsToCustomer(
      customerId: string,
      couponId: string,
      metadata?: Record<string, string>,
      referralCount: number = 1,
    ): Promise<Stripe.Invoice> {
      const productId = getEnvSecrets().STRIPE_CREDIT_PRODUCT_ID;
      const price = await this.getPriceByProductId(productId);

      const coupon = await stripe.coupons.retrieve(couponId);
      if (!coupon) throw new Error("Coupon not found");
      if (!coupon.percent_off) {
        throw new Error("Coupon must have percent_off");
      }
      const credits = getCreditsForCoupon(coupon);

      // 1) Add invoice items representing the free credits
      const itemsToCreate = Math.min(referralCount!, MAX_REFERRAL_COUNT);
      await Promise.all(
        Array.from({ length: itemsToCreate }).map((_, index) =>
          stripe.invoiceItems.create({
            customer: customerId,
            pricing: { price: price.id },
            currency: price.currency,
            quantity: credits,
            description: `Referral credit redemption (${credits} credits) - ${index + 1} of ${itemsToCreate}`,
            metadata: {
              coupon_id: couponId,
              redemption_type: "free_coupon",
              ...(metadata ?? {}),
            },
            discounts: [{ coupon: couponId }],
          }),
        ),
      );

      // 2) Create & finalize zero-total invoice with the coupon discount
      const invoice = await stripe.invoices.create({
        customer: customerId,
        currency: price.currency,
        pending_invoice_items_behavior: "include",
        collection_method: "charge_automatically",
        auto_advance: true,
        metadata: { coupon_id: couponId, price_id: price.id },
        expand: ["lines.data.price.product"],
      });

      const finalizedInvoice = await stripe.invoices.finalizeInvoice(
        invoice.id!,
      );

      return finalizedInvoice;
    },
  };
})();
