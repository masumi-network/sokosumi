import { beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock, retrieveProductWithDefaultPriceMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  retrieveProductWithDefaultPriceMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    retrieveProductWithDefaultPrice: retrieveProductWithDefaultPriceMock,
  },
}));

const ENV = {
  STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID: "prod_starter",
  STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID: "prod_standard",
  STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID: "prod_pro",
};

interface MockProductParams {
  credits?: number;
  interval?: "day" | "month" | "week" | "year";
  intervalCount?: number;
  planName: "pro" | "standard" | "starter";
  priceId: string;
  productId: string;
  unitAmount: number;
}

function createMockProduct(params: MockProductParams): unknown {
  return {
    active: true,
    default_price: {
      id: params.priceId,
      recurring: {
        interval: params.interval ?? "month",
        interval_count: params.intervalCount ?? 1,
      },
      type: "recurring",
      unit_amount: params.unitAmount,
      currency: "eur",
      metadata: {},
    },
    metadata: {
      slug: params.planName,
      ...(params.credits === undefined
        ? {}
        : { credits: String(params.credits) }),
    },
    id: params.productId,
  };
}

function createBaseProducts(): Record<string, unknown> {
  return {
    [ENV.STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID]: createMockProduct({
      planName: "starter",
      priceId: "price_starter",
      productId: ENV.STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID,
      credits: 1750,
      unitAmount: 2500,
    }),
    [ENV.STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID]: createMockProduct({
      planName: "standard",
      priceId: "price_standard",
      productId: ENV.STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID,
      credits: 5250,
      unitAmount: 7500,
    }),
    [ENV.STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID]: createMockProduct({
      planName: "pro",
      priceId: "price_pro",
      productId: ENV.STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID,
      credits: 14000,
      unitAmount: 20000,
    }),
  };
}

function mockProducts(overrides: Record<string, unknown> = {}): void {
  const products = {
    ...createBaseProducts(),
    ...overrides,
  };

  retrieveProductWithDefaultPriceMock.mockImplementation(
    async (productId: string) => {
      const product = products[productId];
      if (!product) {
        throw new Error(`Unexpected product id: ${productId}`);
      }

      return product;
    },
  );
}

describe("subscription-catalog.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getEnvMock.mockReturnValue(ENV);
  });

  it("builds catalog from paid product metadata and a synthetic local free tier", async () => {
    mockProducts();

    const { getSubscriptionCatalog } = await import(
      "./subscription-catalog.service"
    );

    const catalog = await getSubscriptionCatalog();
    expect(catalog.free.credits).toBe(250);
    expect(catalog.free.productId).toBe("local-free");
    expect(catalog.free.monthlyAmount).toBe(0);
    expect(catalog.starter.credits).toBe(1750);
    expect(catalog.standard.monthlyAmount).toBe(7500);
    expect(catalog.pro.priceId).toBe("price_pro");
    expect(retrieveProductWithDefaultPriceMock).toHaveBeenCalledTimes(3);
  });

  it("throws when paid product metadata credits are missing", async () => {
    mockProducts({
      [ENV.STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID]: createMockProduct({
        planName: "starter",
        priceId: "price_starter",
        productId: ENV.STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID,
        unitAmount: 2500,
      }),
    });

    const { getSubscriptionCatalog } = await import(
      "./subscription-catalog.service"
    );

    await expect(getSubscriptionCatalog()).rejects.toThrow(
      "Missing credits metadata for starter plan",
    );
  });

  it("throws when the default price is not monthly recurring", async () => {
    mockProducts({
      [ENV.STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID]: createMockProduct({
        planName: "pro",
        priceId: "price_pro",
        productId: ENV.STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID,
        credits: 14000,
        unitAmount: 20000,
        interval: "year",
      }),
    });

    const { getSubscriptionCatalog } = await import(
      "./subscription-catalog.service"
    );

    await expect(getSubscriptionCatalog()).rejects.toThrow(
      "pro plan must have monthly recurring pricing",
    );
  });

  it("does not cache failed loads and retries on the next call", async () => {
    retrieveProductWithDefaultPriceMock.mockRejectedValueOnce(
      new Error("stripe down"),
    );

    const { getSubscriptionCatalog } = await import(
      "./subscription-catalog.service"
    );

    await expect(getSubscriptionCatalog()).rejects.toThrow();

    mockProducts();
    const catalog = await getSubscriptionCatalog();
    expect(catalog.starter.credits).toBe(1750);
  });

  it("invalidates the cached catalog on demand", async () => {
    mockProducts();

    const { getSubscriptionCatalog, invalidateSubscriptionCatalogCache } =
      await import("./subscription-catalog.service");

    await getSubscriptionCatalog();
    await getSubscriptionCatalog();
    expect(retrieveProductWithDefaultPriceMock).toHaveBeenCalledTimes(3);

    invalidateSubscriptionCatalogCache();

    await getSubscriptionCatalog();
    expect(retrieveProductWithDefaultPriceMock).toHaveBeenCalledTimes(6);
  });
});
