import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  stripeConstructorMock,
  stripeCouponsRetrieveMock,
  stripeCustomersCreateMock,
  stripeInvoiceItemsCreateMock,
  stripeInvoicesCreateMock,
  stripeInvoicesFinalizeMock,
  stripePricesListMock,
  stripeProductsRetrieveMock,
} = vi.hoisted(() => ({
  stripeConstructorMock: vi.fn(),
  stripeCouponsRetrieveMock: vi.fn(),
  stripeCustomersCreateMock: vi.fn(),
  stripeInvoiceItemsCreateMock: vi.fn(),
  stripeInvoicesCreateMock: vi.fn(),
  stripeInvoicesFinalizeMock: vi.fn(),
  stripePricesListMock: vi.fn(),
  stripeProductsRetrieveMock: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class StripeMock {
    customers = {
      create: (...args: unknown[]) => stripeCustomersCreateMock(...args),
    };

    coupons = {
      retrieve: (...args: unknown[]) => stripeCouponsRetrieveMock(...args),
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

    expect(stripeInvoiceItemsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        quantity: 500,
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
});
