import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const getEnvSecretsMock = vi.fn();

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: getEnvSecretsMock,
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

function createBaseProducts() {
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

function createMockStripe(params?: { products?: Record<string, unknown> }) {
  const products = {
    ...createBaseProducts(),
    ...(params?.products ?? {}),
  };
  const retrieveMock = vi.fn(async (productId: string) => {
    const product = products[productId];
    if (!product) {
      throw new Error(`Unexpected product id: ${productId}`);
    }

    return product;
  });

  return {
    retrieveMock,
    stripe: {
      products: {
        retrieve: retrieveMock,
      },
    },
  };
}

describe("subscription-catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getEnvSecretsMock.mockReturnValue(ENV);
  });

  it("builds catalog from paid product metadata and a synthetic local free tier", async () => {
    const { retrieveMock, stripe } = createMockStripe();

    const { getBetterAuthSubscriptionPlans, getSubscriptionCatalog } =
      await import("../subscription-catalog");

    const catalog = await getSubscriptionCatalog(stripe as never);
    expect(catalog.free.credits).toBe(250);
    expect(catalog.free.productId).toBe("local-free");
    expect(catalog.free.monthlyAmount).toBe(0);
    expect(catalog.starter.credits).toBe(1750);
    expect(catalog.standard.monthlyAmount).toBe(7500);
    expect(catalog.pro.priceId).toBe("price_pro");
    expect(retrieveMock).toHaveBeenCalledTimes(3);

    const plans = await getBetterAuthSubscriptionPlans(stripe as never);
    expect(plans).toEqual([
      {
        limits: { credits: 1750 },
        name: "starter",
        priceId: "price_starter",
      },
      {
        limits: { credits: 5250 },
        name: "standard",
        priceId: "price_standard",
      },
      {
        limits: { credits: 14000 },
        name: "pro",
        priceId: "price_pro",
      },
    ]);
  });

  it("throws when paid product metadata credits are missing", async () => {
    const { stripe } = createMockStripe({
      products: {
        [ENV.STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID]: createMockProduct({
          planName: "starter",
          priceId: "price_starter",
          productId: ENV.STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID,
          unitAmount: 2500,
        }),
      },
    });

    const { getSubscriptionCatalog } = await import("../subscription-catalog");

    await expect(getSubscriptionCatalog(stripe as never)).rejects.toThrow(
      "Missing credits metadata for starter plan",
    );
  });

  it("invalidates the cached catalog on demand", async () => {
    const { retrieveMock, stripe } = createMockStripe();

    const { getSubscriptionCatalog, invalidateSubscriptionCatalogCache } =
      await import("../subscription-catalog");

    await getSubscriptionCatalog(stripe as never);
    await getSubscriptionCatalog(stripe as never);
    expect(retrieveMock).toHaveBeenCalledTimes(3);

    invalidateSubscriptionCatalogCache();

    await getSubscriptionCatalog(stripe as never);
    expect(retrieveMock).toHaveBeenCalledTimes(6);
  });
});
