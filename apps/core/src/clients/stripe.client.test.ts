import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  stripeConstructorMock,
  stripeCheckoutSessionsCreateMock,
  stripeCheckoutSessionsRetrieveMock,
  stripeCouponsRetrieveMock,
  stripeCustomersCreateMock,
  stripeInvoiceItemsCreateMock,
  stripeInvoicesCreateMock,
  stripeInvoicesFinalizeMock,
  stripePricesListMock,
  stripeProductsRetrieveMock,
  stripeSubscriptionsUpdateMock,
} = vi.hoisted(() => ({
  stripeConstructorMock: vi.fn(),
  stripeCheckoutSessionsCreateMock: vi.fn(),
  stripeCheckoutSessionsRetrieveMock: vi.fn(),
  stripeCouponsRetrieveMock: vi.fn(),
  stripeCustomersCreateMock: vi.fn(),
  stripeInvoiceItemsCreateMock: vi.fn(),
  stripeInvoicesCreateMock: vi.fn(),
  stripeInvoicesFinalizeMock: vi.fn(),
  stripePricesListMock: vi.fn(),
  stripeProductsRetrieveMock: vi.fn(),
  stripeSubscriptionsUpdateMock: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class StripeMock {
    customers = {
      create: (...args: unknown[]) => stripeCustomersCreateMock(...args),
    };

    coupons = {
      retrieve: (...args: unknown[]) => stripeCouponsRetrieveMock(...args),
    };

    checkout = {
      sessions: {
        create: (...args: unknown[]) =>
          stripeCheckoutSessionsCreateMock(...args),
        retrieve: (...args: unknown[]) =>
          stripeCheckoutSessionsRetrieveMock(...args),
      },
    };

    products = {
      retrieve: (...args: unknown[]) => stripeProductsRetrieveMock(...args),
    };

    prices = {
      list: (...args: unknown[]) => stripePricesListMock(...args),
    };

    invoiceItems = {
      create: (...args: unknown[]) => stripeInvoiceItemsCreateMock(...args),
    };

    invoices = {
      create: (...args: unknown[]) => stripeInvoicesCreateMock(...args),
      finalizeInvoice: (...args: unknown[]) =>
        stripeInvoicesFinalizeMock(...args),
    };

    subscriptions = {
      update: (...args: unknown[]) => stripeSubscriptionsUpdateMock(...args),
    };

    constructor(secretKey: string, options?: unknown) {
      stripeConstructorMock(secretKey, options);
    }
  },
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    STRIPE_CREDIT_PRODUCT_ID: "prod_credit",
    STRIPE_SECRET_KEY: "sk_test_core",
  }),
  getWebAppBaseUrl: () => "https://app.sokosumi.test",
}));

function mockCreditProductAndCoupon(
  couponMetadata: Record<string, string> = { credits: "500" },
): void {
  stripeProductsRetrieveMock.mockResolvedValue({
    default_price: {
      id: "price_credits",
      currency: "eur",
      unit_amount: 120,
      unit_amount_decimal: "120",
    },
  });
  stripeCouponsRetrieveMock.mockResolvedValue({
    id: "coupon_1",
    metadata: couponMetadata,
    percent_off: 100,
  });
  stripeInvoiceItemsCreateMock.mockResolvedValue({ id: "ii_1" });
  stripeInvoicesCreateMock.mockResolvedValue({ id: "in_1" });
  stripeInvoicesFinalizeMock.mockResolvedValue({
    id: "in_1",
    status: "paid",
  });
}

describe("stripeClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    stripeCustomersCreateMock.mockResolvedValue({ id: "cus_123" });
  });

  it("creates a Stripe client with the configured secret key", async () => {
    await import("./stripe.client");

    expect(stripeConstructorMock).toHaveBeenCalledWith("sk_test_core", {
      maxNetworkRetries: 0,
    });
  });

  it("creates a user customer with user metadata and idempotency", async () => {
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.createUserCustomer({
      email: "andreas@example.com",
      name: "Andreas",
      userId: "user_123",
    });

    expect(stripeCustomersCreateMock).toHaveBeenCalledWith(
      {
        email: "andreas@example.com",
        metadata: {
          customerType: "user",
          userId: "user_123",
        },
        name: "Andreas",
      },
      {
        idempotencyKey: "user-user_123",
        maxNetworkRetries: 0,
      },
    );
  });

  it("creates an organization customer with optional request options", async () => {
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.createOrganizationCustomer(
      {
        invoiceEmail: "billing@example.com",
        name: "Sokosumi Org",
        organizationId: "org_123",
        slug: "sokosumi-org",
      },
      {
        timeout: 2500,
      },
    );

    expect(stripeCustomersCreateMock).toHaveBeenCalledWith(
      {
        email: "billing@example.com",
        metadata: {
          customerType: "organization",
          organizationId: "org_123",
          organizationSlug: "sokosumi-org",
        },
        name: "Sokosumi Org",
      },
      {
        idempotencyKey: "organization-org_123",
        maxNetworkRetries: 0,
        timeout: 2500,
      },
    );
  });

  it("returns null when a coupon lookup fails", async () => {
    stripeCouponsRetrieveMock.mockRejectedValue(new Error("missing"));
    const { stripeClient } = await import("./stripe.client");

    await expect(stripeClient.getCouponById("coupon_gone")).resolves.toBeNull();
  });

  it("creates invoice items with quantity matching coupon credits", async () => {
    mockCreditProductAndCoupon();
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.applyInvoiceCreditsToCustomer(
      "cus_1",
      "coupon_1",
      "grant-coupon_1-user-1",
    );

    // The description is part of Stripe's idempotent request body — it must
    // stay byte-identical to the web client so cross-app replays of the same
    // key succeed instead of failing with idempotency_error.
    expect(stripeInvoiceItemsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        quantity: 500,
        description: "Referral credit redemption (500 credits) - 1 of 1",
      }),
      expect.anything(),
    );
  });

  it("passes derived idempotency keys to every stripe call", async () => {
    mockCreditProductAndCoupon();
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.applyInvoiceCreditsToCustomer(
      "cus_1",
      "coupon_1",
      "welcome-coupon_1-user-1",
    );

    expect(stripeInvoiceItemsCreateMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        idempotencyKey: "welcome-coupon_1-user-1-item-1",
      },
    );
    expect(stripeInvoicesCreateMock).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: "welcome-coupon_1-user-1-invoice",
    });
    expect(stripeInvoicesFinalizeMock).toHaveBeenCalledWith(
      "in_1",
      {},
      { idempotencyKey: "welcome-coupon_1-user-1-finalize" },
    );
  });

  it("derives a distinct idempotency key per referral invoice item", async () => {
    mockCreditProductAndCoupon();
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.applyInvoiceCreditsToCustomer(
      "cus_1",
      "coupon_1",
      "referral-coupon_1-user-1-2",
      undefined,
      2,
    );

    expect(stripeInvoiceItemsCreateMock).toHaveBeenCalledTimes(2);
    expect(stripeInvoiceItemsCreateMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        idempotencyKey: "referral-coupon_1-user-1-2-item-1",
      },
    );
    expect(stripeInvoiceItemsCreateMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        idempotencyKey: "referral-coupon_1-user-1-2-item-2",
      },
    );
  });

  it("propagates custom metadata onto invoice metadata", async () => {
    mockCreditProductAndCoupon();
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.applyInvoiceCreditsToCustomer(
      "cus_1",
      "coupon_1",
      "welcome-coupon_1-user-1",
      {
        redemption_type: "welcome_coupon",
        welcome_source: "customer.created",
      },
    );

    expect(stripeInvoicesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        automatic_tax: { enabled: true },
        metadata: expect.objectContaining({
          coupon_id: "coupon_1",
          price_id: "price_credits",
          redemption_type: "welcome_coupon",
          welcome_source: "customer.created",
        }),
      }),
      expect.anything(),
    );
  });

  it("propagates coupon ttl_days metadata onto invoice metadata", async () => {
    mockCreditProductAndCoupon({ credits: "500", ttl_days: "90" });
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.applyInvoiceCreditsToCustomer(
      "cus_1",
      "coupon_1",
      "grant-coupon_1-user-1",
    );

    expect(stripeInvoicesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          coupon_id: "coupon_1",
          price_id: "price_credits",
          ttl_days: "90",
        }),
      }),
      expect.anything(),
    );
  });

  it("enables automatic tax when updating subscription item quantity", async () => {
    stripeSubscriptionsUpdateMock.mockResolvedValue({ id: "sub_1" });
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.updateSubscriptionItemQuantity("sub_1", "si_1", 3);

    expect(stripeSubscriptionsUpdateMock).toHaveBeenCalledWith(
      "sub_1",
      expect.objectContaining({
        automatic_tax: { enabled: true },
        items: [
          {
            id: "si_1",
            quantity: 3,
          },
        ],
        payment_behavior: "error_if_incomplete",
        proration_behavior: "always_invoice",
      }),
      undefined,
    );
  });

  it("falls back to listed prices when the default price is not a valid credit price", async () => {
    stripeProductsRetrieveMock.mockResolvedValue({
      default_price: {
        id: "price_bad",
        currency: "gbp",
        unit_amount: 120,
        unit_amount_decimal: "120",
      },
    });
    stripePricesListMock.mockResolvedValue({
      data: [
        {
          id: "price_usd",
          currency: "usd",
          unit_amount: 100,
          unit_amount_decimal: "100",
        },
        {
          id: "price_eur",
          currency: "eur",
          unit_amount: 120,
          unit_amount_decimal: "120",
        },
      ],
    });
    const { stripeClient } = await import("./stripe.client");

    const price = await stripeClient.getPriceByProductId("prod_credit");

    // eur is preferred over usd regardless of list order
    expect(price).toEqual({
      id: "price_eur",
      amountPerCredit: 120,
      currency: "eur",
    });
  });

  it("rejects coupons without positive integer credits metadata", async () => {
    mockCreditProductAndCoupon({ credits: "-5" });
    const { stripeClient } = await import("./stripe.client");

    await expect(
      stripeClient.applyInvoiceCreditsToCustomer(
        "cus_1",
        "coupon_1",
        "grant-coupon_1-user-1",
      ),
    ).rejects.toThrow("Coupon metadata credits must be a positive integer");

    expect(stripeInvoiceItemsCreateMock).not.toHaveBeenCalled();
  });

  it("creates credit checkout sessions with the configured web origin only", async () => {
    stripeCheckoutSessionsCreateMock.mockResolvedValue({
      id: "cs_123",
      url: "https://checkout.stripe.com/c/pay/cs_123",
    });
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.createCreditCheckoutSession({
      stripeCustomerId: "cus_1",
      userId: "user_1",
      organizationId: null,
      credits: 1000,
      price: {
        id: "price_credits",
        amountPerCredit: 120,
        currency: "eur",
      },
      returnPath: "/billing?tab=credits",
    });

    expect(stripeCheckoutSessionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        automatic_tax: { enabled: true },
        success_url:
          "https://app.sokosumi.test/billing?tab=credits&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://app.sokosumi.test/billing?tab=credits&cancel=true",
      }),
    );
  });

  it("does not put ttl_days metadata on paid credit checkout sessions", async () => {
    stripeCheckoutSessionsCreateMock.mockResolvedValue({
      id: "cs_123",
      url: "https://checkout.stripe.com/c/pay/cs_123",
    });
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.createCreditCheckoutSession({
      stripeCustomerId: "cus_1",
      userId: "user_1",
      organizationId: "org_1",
      credits: 1000,
      price: {
        id: "price_credits",
        amountPerCredit: 120,
        currency: "eur",
      },
    });

    expect(stripeCheckoutSessionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_creation: {
          enabled: true,
          invoice_data: {
            metadata: expect.not.objectContaining({
              ttl_days: expect.anything(),
            }),
          },
        },
        metadata: expect.not.objectContaining({ ttl_days: expect.anything() }),
      }),
    );
  });
});

describe("stripeClient.createAdminInvoice", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    stripeInvoicesCreateMock.mockResolvedValue({ id: "in_1" });
    stripeInvoiceItemsCreateMock.mockResolvedValue({ id: "ii_1" });
    stripeInvoicesFinalizeMock.mockResolvedValue({
      id: "in_1",
      status: "open",
    });
  });

  it("bills the line item against the product price and discounts the item", async () => {
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.createAdminInvoice({
      customerId: "cus_1",
      credits: 1000,
      priceId: "price_credit",
      currency: "eur",
      couponId: "coupon_support",
    });

    // The invoice is created empty, so the discount must NOT sit on the invoice
    // (it would compute against €0); it belongs on the product-priced line item
    // so a product-scoped coupon applies.
    expect(stripeInvoicesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        automatic_tax: { enabled: true },
      }),
    );
    expect(stripeInvoicesCreateMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        discounts: expect.anything(),
      }),
    );
    expect(stripeInvoiceItemsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice: "in_1",
        pricing: { price: "price_credit" },
        quantity: 1000,
        discounts: [{ coupon: "coupon_support" }],
      }),
    );
  });

  it("omits the discount when no coupon is provided", async () => {
    const { stripeClient } = await import("./stripe.client");

    await stripeClient.createAdminInvoice({
      customerId: "cus_1",
      credits: 1000,
      priceId: "price_credit",
      currency: "eur",
    });

    expect(stripeInvoiceItemsCreateMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "discounts",
    );
  });
});
