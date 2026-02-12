jest.mock("server-only", () => ({}));
export {};

const checkoutSessionsCreateMock = jest.fn();
const couponsRetrieveMock = jest.fn();
const getEnvSecretsMock = jest.fn();
const invoiceItemsCreateMock = jest.fn();
const invoicesCreateMock = jest.fn();
const invoicesFinalizeInvoiceMock = jest.fn();
const pricesListMock = jest.fn();
const productsRetrieveMock = jest.fn();

jest.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

jest.mock("stripe", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
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
  })),
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
    jest.clearAllMocks();
    jest.resetModules();
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
          "https://app.sokosumi.com/credits?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://app.sokosumi.com/credits?cancel=true",
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

  it("creates invoice items with quantity matching coupon credits", async () => {
    productsRetrieveMock.mockResolvedValue({
      default_price: createMockStripePrice({
        currency: "eur",
        id: "price_credits",
        unitAmount: 120,
      }),
    });
    couponsRetrieveMock.mockResolvedValue({
      id: "coupon_1",
      metadata: { credits: "500" },
      percent_off: 100,
    });
    invoiceItemsCreateMock.mockResolvedValue({ id: "ii_1" });
    invoicesCreateMock.mockResolvedValue({ id: "in_1" });
    invoicesFinalizeInvoiceMock.mockResolvedValue({
      id: "in_1",
      status: "paid",
    });

    const { stripeClient } = await import("../stripe.client");
    await stripeClient.applyInvoiceCreditsToCustomer("cus_1", "coupon_1");

    expect(invoiceItemsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        quantity: 500,
      }),
    );
  });
});
