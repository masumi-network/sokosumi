import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  stripeConstructorMock,
  stripeCheckoutSessionsCreateMock,
  stripeCheckoutSessionsRetrieveMock,
  stripeCouponsRetrieveMock,
  stripeCustomersCreateMock,
  stripeCustomersRetrieveMock,
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
  stripeCustomersRetrieveMock: vi.fn(),
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
      retrieve: (...args: unknown[]) => stripeCustomersRetrieveMock(...args),
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

  it("retrieves billing details with expanded tax ids", async () => {
    stripeCustomersRetrieveMock.mockResolvedValue({
      id: "cus_1",
      email: "billing@example.com",
      deleted: false,
      address: {
        line1: "123 Main St",
        line2: null,
        city: "Berlin",
        state: null,
        postal_code: "10115",
        country: "DE",
      },
      tax_ids: {
        data: [
          {
            id: "txi_1",
            type: "eu_vat",
            value: "DE123456789",
            country: "DE",
            verification: { status: "verified" },
          },
        ],
      },
    });
    const { stripeClient } = await import("./stripe.client");

    await expect(
      stripeClient.retrieveCustomerBillingDetails("cus_1"),
    ).resolves.toEqual({
      stripeCustomerId: "cus_1",
      email: "billing@example.com",
      address: {
        line1: "123 Main St",
        line2: null,
        city: "Berlin",
        state: null,
        postalCode: "10115",
        country: "DE",
      },
      taxIds: [
        {
          id: "txi_1",
          type: "eu_vat",
          value: "DE123456789",
          country: "DE",
          verificationStatus: "verified",
        },
      ],
    });
    expect(stripeCustomersRetrieveMock).toHaveBeenCalledWith(
      "cus_1",
      { expand: ["tax_ids"] },
      undefined,
    );
  });

  it("returns partial billing address when stripe address is incomplete", async () => {
    stripeCustomersRetrieveMock.mockResolvedValue({
      id: "cus_1",
      email: null,
      deleted: false,
      address: {
        line1: "123 Main St",
        line2: null,
        city: null,
        state: null,
        postal_code: null,
        country: null,
      },
      tax_ids: { data: [] },
    });
    const { stripeClient } = await import("./stripe.client");

    await expect(
      stripeClient.retrieveCustomerBillingDetails("cus_1"),
    ).resolves.toEqual({
      stripeCustomerId: "cus_1",
      email: null,
      address: {
        line1: "123 Main St",
        line2: null,
        city: "",
        state: null,
        postalCode: "",
        country: "",
      },
      taxIds: [],
    });
  });

  it("returns empty billing details when stripe customer was deleted", async () => {
    stripeCustomersRetrieveMock.mockResolvedValue({
      id: "cus_1",
      deleted: true,
    });
    const { stripeClient } = await import("./stripe.client");

    await expect(
      stripeClient.retrieveCustomerBillingDetails("cus_1"),
    ).resolves.toEqual({
      stripeCustomerId: null,
      email: null,
      address: null,
      taxIds: [],
    });
  });
});
