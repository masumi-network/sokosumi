import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

export {};

const checkoutSessionsCreateMock = vi.fn();
const couponsRetrieveMock = vi.fn();
const getEnvSecretsMock = vi.fn();
const invoiceItemsCreateMock = vi.fn();
const invoicesCreateMock = vi.fn();
const invoicesFinalizeInvoiceMock = vi.fn();
const pricesListMock = vi.fn();
const productsRetrieveMock = vi.fn();

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

vi.mock("stripe", () => ({
  __esModule: true,
  default: vi.fn(function MockStripe() {
    return {
      checkout: {
        sessions: {
          create: (...args: unknown[]) => checkoutSessionsCreateMock(...args),
        },
      },
      coupons: {
        retrieve: (...args: unknown[]) => couponsRetrieveMock(...args),
      },
      invoiceItems: {
        create: (...args: unknown[]) => invoiceItemsCreateMock(...args),
      },
      invoices: {
        create: (...args: unknown[]) => invoicesCreateMock(...args),
        finalizeInvoice: (...args: unknown[]) =>
          invoicesFinalizeInvoiceMock(...args),
      },
      prices: {
        list: (...args: unknown[]) => pricesListMock(...args),
      },
      products: {
        retrieve: (...args: unknown[]) => productsRetrieveMock(...args),
      },
    };
  }),
}));

interface MockStripePriceParams {
  currency: string;
  id: string;
  unitAmount?: number | null;
  unitAmountDecimal?: string | null;
}

function createMockStripePrice(params: MockStripePriceParams): never {
  return {
    currency: params.currency,
    id: params.id,
    unit_amount: params.unitAmount ?? null,
    unit_amount_decimal: params.unitAmountDecimal ?? null,
  } as never;
}

describe("stripe.client lookup-key pricing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getEnvSecretsMock.mockReturnValue({
      STRIPE_CREDIT_PRODUCT_ID: "prod_credit",
      STRIPE_SECRET_KEY: "sk_test_mock",
      STRIPE_WEBHOOK_SECRET: "whsec_test_mock",
      VERCEL_URL: "https://app.test",
    });
  });

  it("retrieves a price by lookup key", async () => {
    pricesListMock.mockResolvedValue({
      data: [
        createMockStripePrice({
          currency: "usd",
          id: "price_usd",
          unitAmount: null,
          unitAmountDecimal: "1.25",
        }),
        createMockStripePrice({
          currency: "eur",
          id: "price_eur",
          unitAmount: null,
          unitAmountDecimal: "1.2",
        }),
      ],
    });

    const { stripeClient } = await import("../stripe.client");
    const price = await stripeClient.getPriceByLookupKey("credit_20_margin");

    expect(pricesListMock).toHaveBeenCalledWith({
      lookup_keys: ["credit_20_margin"],
      product: "prod_credit",
      active: true,
      limit: 100,
    });
    expect(price).toEqual({
      id: "price_eur",
      amountPerCredit: 1.2,
      currency: "eur",
    });
  });

  it("falls back to usd when eur is not valid", async () => {
    pricesListMock.mockResolvedValue({
      data: [
        createMockStripePrice({
          currency: "eur",
          id: "price_eur_invalid",
          unitAmount: 0,
        }),
        createMockStripePrice({
          currency: "usd",
          id: "price_usd_valid",
          unitAmount: null,
          unitAmountDecimal: "1.5",
        }),
      ],
    });

    const { stripeClient } = await import("../stripe.client");
    const price = await stripeClient.getPriceByLookupKey("credit_15_margin");

    expect(price).toEqual({
      id: "price_usd_valid",
      amountPerCredit: 1.5,
      currency: "usd",
    });
  });

  it("throws when lookup key has no valid active prices", async () => {
    pricesListMock.mockResolvedValue({ data: [] });
    const { stripeClient } = await import("../stripe.client");

    await expect(
      stripeClient.getPriceByLookupKey("credit_10_margin"),
    ).rejects.toThrow(
      "No valid credit price found for lookup key credit_10_margin",
    );
  });

  it("maps credit amounts to tiered lookup keys", async () => {
    pricesListMock.mockImplementation(
      async (params: { lookup_keys: string[] }) => {
        const lookupKey = params.lookup_keys[0];
        return {
          data: [
            createMockStripePrice({
              currency: "eur",
              id: `price_${lookupKey}`,
              unitAmount: null,
              unitAmountDecimal: "1.2",
            }),
          ],
        };
      },
    );

    const { stripeClient } = await import("../stripe.client");

    await stripeClient.getCreditTopUpPriceByCredits(9_999);
    await stripeClient.getCreditTopUpPriceByCredits(10_000);
    await stripeClient.getCreditTopUpPriceByCredits(100_000);

    expect(
      pricesListMock.mock.calls.map((call) => call[0].lookup_keys[0]),
    ).toEqual(["credit_20_margin", "credit_15_margin", "credit_10_margin"]);
  });

  it("uses a lookup key override regardless of credit amount", async () => {
    pricesListMock.mockImplementation(
      async (params: { lookup_keys: string[] }) => {
        const lookupKey = params.lookup_keys[0];
        return {
          data: [
            createMockStripePrice({
              currency: "eur",
              id: `price_${lookupKey}`,
              unitAmount: null,
              unitAmountDecimal: "1.0",
            }),
          ],
        };
      },
    );

    const { stripeClient } = await import("../stripe.client");

    await stripeClient.getCreditTopUpPriceByCredits(1, "credit_0_margin");
    await stripeClient.getCreditTopUpPriceByCredits(10_000, "credit_0_margin");
    await stripeClient.getCreditTopUpPriceByCredits(250_000, "credit_0_margin");

    expect(
      pricesListMock.mock.calls.map((call) => call[0].lookup_keys[0]),
    ).toEqual(["credit_0_margin", "credit_0_margin", "credit_0_margin"]);
  });

  it("only loads the standard top-up tiers for the default catalog", async () => {
    pricesListMock.mockImplementation(
      async (params: { lookup_keys: string[] }) => {
        const lookupKey = params.lookup_keys[0];
        return {
          data: [
            createMockStripePrice({
              currency: "eur",
              id: `price_${lookupKey}`,
              unitAmount: null,
              unitAmountDecimal: "1.2",
            }),
          ],
        };
      },
    );

    const { stripeClient } = await import("../stripe.client");

    const priceCatalog = await stripeClient.getCreditTopUpPriceCatalog();

    expect(priceCatalog).toEqual({
      credit_20_margin: {
        id: "price_credit_20_margin",
        amountPerCredit: 1.2,
        currency: "eur",
      },
      credit_15_margin: {
        id: "price_credit_15_margin",
        amountPerCredit: 1.2,
        currency: "eur",
      },
      credit_10_margin: {
        id: "price_credit_10_margin",
        amountPerCredit: 1.2,
        currency: "eur",
      },
    });
    expect(
      pricesListMock.mock.calls.map((call) => call[0].lookup_keys[0]),
    ).toEqual(["credit_20_margin", "credit_15_margin", "credit_10_margin"]);
  });

  it("accepts unit_amount_decimal when unit_amount is null", async () => {
    pricesListMock.mockResolvedValue({
      data: [
        createMockStripePrice({
          currency: "eur",
          id: "price_decimal",
          unitAmount: null,
          unitAmountDecimal: "1.15",
        }),
      ],
    });

    const { stripeClient } = await import("../stripe.client");
    const price = await stripeClient.getPriceByLookupKey("credit_15_margin");

    expect(price).toEqual({
      id: "price_decimal",
      amountPerCredit: 1.15,
      currency: "eur",
    });
  });

  it("creates top-up checkout linked to the credit product", async () => {
    checkoutSessionsCreateMock.mockResolvedValue({ id: "cs_123", url: "test" });
    const { stripeClient } = await import("../stripe.client");

    await stripeClient.createCheckoutSession(
      "cus_1",
      "user-1",
      null,
      25_000,
      {
        id: "price_credits",
        amountPerCredit: 1.2,
        currency: "eur",
      },
      "https://app.sokosumi.com",
    );

    expect(checkoutSessionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          {
            price_data: {
              currency: "eur",
              product: "prod_credit",
              unit_amount: 30000,
            },
            quantity: 1,
          },
        ],
        allow_promotion_codes: false,
        custom_text: {
          submit: {
            message:
              "25,000 credits will be added to your account after checkout.",
          },
        },
        metadata: expect.objectContaining({
          credits: 25_000,
          userId: "user-1",
        }),
        success_url:
          "https://app.sokosumi.com/billing?tab=credits&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://app.sokosumi.com/billing?tab=credits&cancel=true",
      }),
    );
  });

  it("creates coupon checkout with credit product id and coupon return path", async () => {
    checkoutSessionsCreateMock.mockResolvedValue({ id: "cs_456", url: "test" });
    const { stripeClient } = await import("../stripe.client");

    await stripeClient.createCheckoutSession(
      "cus_1",
      "user-1",
      null,
      25_000,
      {
        id: "price_credits",
        amountPerCredit: 1.2,
        currency: "eur",
      },
      "https://app.sokosumi.com",
      "promo_1",
      "/coupon",
    );

    expect(checkoutSessionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          {
            price_data: {
              currency: "eur",
              product: "prod_credit",
              unit_amount: 30000,
            },
            quantity: 1,
          },
        ],
        discounts: [{ promotion_code: "promo_1" }],
        custom_text: {
          submit: {
            message:
              "25,000 credits will be added to your account after checkout.",
          },
        },
        success_url:
          "https://app.sokosumi.com/coupon?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://app.sokosumi.com/coupon?cancel=true",
      }),
    );
  });

  it("propagates checkout metadata into created invoice metadata", async () => {
    checkoutSessionsCreateMock.mockResolvedValue({ id: "cs_457", url: "test" });
    const { stripeClient } = await import("../stripe.client");

    await stripeClient.createCheckoutSession(
      "cus_1",
      "user-1",
      null,
      25_000,
      {
        id: "price_credits",
        amountPerCredit: 1.2,
        currency: "eur",
      },
      "https://app.sokosumi.com",
      "promo_1",
      "/coupon",
      "90",
    );

    expect(checkoutSessionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          credits: 25_000,
          userId: "user-1",
          ttl_days: "90",
        }),
        invoice_creation: {
          enabled: true,
          invoice_data: {
            metadata: expect.objectContaining({
              credits: 25_000,
              userId: "user-1",
              ttl_days: "90",
            }),
          },
        },
      }),
    );
  });

  it("preserves existing query params in return path for checkout urls", async () => {
    checkoutSessionsCreateMock.mockResolvedValue({ id: "cs_789", url: "test" });
    const { stripeClient } = await import("../stripe.client");

    await stripeClient.createCheckoutSession(
      "cus_1",
      "user-1",
      null,
      25_000,
      {
        id: "price_credits",
        amountPerCredit: 1.2,
        currency: "eur",
      },
      "https://app.sokosumi.com",
      null,
      "/billing?tab=credits",
    );

    expect(checkoutSessionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url:
          "https://app.sokosumi.com/billing?tab=credits&session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://app.sokosumi.com/billing?tab=credits&cancel=true",
      }),
    );
  });
});

describe("stripe.client createCreditGrantInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getEnvSecretsMock.mockReturnValue({
      STRIPE_CREDIT_PRODUCT_ID: "prod_credit",
      STRIPE_SECRET_KEY: "sk_test_mock",
      STRIPE_WEBHOOK_SECRET: "whsec_test_mock",
      VERCEL_URL: "https://app.test",
    });
    invoicesCreateMock.mockResolvedValue({ id: "in_1" });
    invoiceItemsCreateMock.mockResolvedValue({ id: "ii_1" });
    invoicesFinalizeInvoiceMock.mockResolvedValue({
      id: "in_1",
      status: "open",
    });
  });

  it("bills the line item against the product price and discounts the item", async () => {
    const { stripeClient } = await import("../stripe.client");
    await stripeClient.createCreditGrantInvoice({
      customerId: "cus_1",
      credits: 1000,
      priceId: "price_credit",
      currency: "eur",
      couponId: "coupon_support",
    });

    // The invoice is created empty, so the discount must NOT sit on the invoice
    // (it would compute against €0); it belongs on the product-priced line item
    // so a product-scoped coupon applies.
    expect(invoicesCreateMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ discounts: expect.anything() }),
    );
    expect(invoiceItemsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice: "in_1",
        pricing: { price: "price_credit" },
        quantity: 1000,
        discounts: [{ coupon: "coupon_support" }],
      }),
    );
  });

  it("omits the discount when no coupon is provided", async () => {
    const { stripeClient } = await import("../stripe.client");
    await stripeClient.createCreditGrantInvoice({
      customerId: "cus_1",
      credits: 1000,
      priceId: "price_credit",
      currency: "eur",
    });

    expect(invoiceItemsCreateMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "discounts",
    );
  });
});
