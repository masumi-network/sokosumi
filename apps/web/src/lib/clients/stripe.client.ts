import "server-only";

import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import { FiatTransaction, Organization, User } from "@/prisma/generated/client";

export interface Price {
  id: string;
  amountPerCredit: number;
  currency: string;
}

export interface CheckoutSessionData {
  session_id: string;
  currency: string | null;
  items: {
    item_id: string;
    item_name: string;
    quantity: number;
  }[];
  value: number;
  isWelcomePromotion: boolean;
}
export const stripeClient = (() => {
  const stripe = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);
  const MAX_REFERRAL_COUNT = 4; // max number of referral credits to apply

  function validatePrice(price: Stripe.Price): Price {
    if (price.currency !== "usd") {
      throw new Error("Price is not in USD");
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
          typeof product.default_price !== "object" ||
          product.default_price === null
        ) {
          throw new Error("Product default price is not expanded");
        }
        return validatePrice(product.default_price);
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

    /**
     * Get the data for a checkout session.
     * This is used for Google Tag Manager to track the checkout session.
     *
     * - session: the checkout session
     * - items: the line items with the product name and quantity
     * - value: the total amount of the checkout session in the currency of the checkout session
     * - isWelcomePromotion: whether the checkout session has a welcome promotion
     */
    async getCheckoutSessionData(id: string): Promise<CheckoutSessionData> {
      const session = await this.getCheckoutSession(id);
      const lineItems = session.line_items?.data ?? [];
      const items = lineItems
        .map((item) => {
          if (
            item.price?.product &&
            typeof item.price.product === "object" &&
            "id" in item.price.product &&
            "name" in item.price.product
          ) {
            return {
              item_id: item.price.product.id,
              item_name: item.price.product.name,
              quantity: item.quantity,
            };
          }
        })
        .filter(Boolean) as {
        item_id: string;
        item_name: string;
        quantity: number;
      }[];
      // NOTE:
      // we only allow support for USD for now
      const value = (session.amount_total ?? 0) / 100;
      const welcomeCouponId = getEnvSecrets().STRIPE_WELCOME_COUPON;
      const isWelcomePromotion =
        session.discounts?.some(
          (discount) =>
            typeof discount.coupon === "object" &&
            discount.coupon &&
            "id" in discount.coupon &&
            discount.coupon.id === welcomeCouponId,
        ) ?? false;

      return {
        session_id: session.id,
        currency: session.currency,
        items,
        value,
        isWelcomePromotion,
      };
    },

    async createCheckoutSession(
      stripeCustomerId: string,
      fiatTransaction: FiatTransaction,
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
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              price: price.id,
              quantity: Math.floor(
                Number(fiatTransaction.amount) / price.amountPerCredit,
              ),
            },
          ],
          ...(promotionCode
            ? { discounts: [{ promotion_code: promotionCode }] }
            : { allow_promotion_codes: false }),
          client_reference_id: fiatTransaction.id,
          customer: stripeCustomerId,
          customer_update: {
            address: "auto",
            name: "auto",
          },
          billing_address_collection: "required",
          tax_id_collection: { enabled: true },
          success_url: `${origin ?? getEnvSecrets().VERCEL_URL}/billing?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin ?? getEnvSecrets().VERCEL_URL}/billing?cancel=true`,
        },
        {
          idempotencyKey: `${stripeCustomerId}-${fiatTransaction.id}`,
        },
      );
      return session;
    },

    async applyInvoiceCreditsToCustomer(
      customerId: string,
      couponId: string,
      metadata?: Record<string, string>,
      referralCount: number = 1,
    ): Promise<Stripe.Invoice> {
      const productId = getEnvSecrets().STRIPE_PRODUCT_ID;
      const price = await this.getPriceByProductId(productId);

      // Validate coupon and compute quantity of credits
      const coupon = await stripe.coupons.retrieve(couponId);
      if (!coupon) throw new Error("Coupon not found");
      if (coupon.percent_off)
        throw new Error("Only fixed-amount coupons are supported");
      if (!coupon.amount_off)
        throw new Error("Coupon must have a fixed amount");
      if (coupon.currency?.toLowerCase() !== price.currency.toLowerCase()) {
        throw new Error(
          `Coupon currency ${coupon.currency ?? "unknown"} does not match price currency ${price.currency}`,
        );
      }
      if (price.amountPerCredit === 0) {
        throw new Error(
          "Price amountPerCredit is 0 – cannot calculate credits for free product",
        );
      }

      const quantity = Math.floor(coupon.amount_off / price.amountPerCredit);
      if (quantity < 1) {
        throw new Error("Coupon amount is too low to redeem any credits");
      }

      // 1) Add invoice items representing the free credits
      const itemsToCreate = Math.min(referralCount!, MAX_REFERRAL_COUNT);
      await Promise.all(
        Array.from({ length: itemsToCreate }).map((_, index) =>
          stripe.invoiceItems.create({
            customer: customerId,
            pricing: { price: price.id },
            currency: price.currency,
            quantity,
            description: `Referral credit redemption (${quantity} credits) - ${index + 1} of ${itemsToCreate}`,
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
