import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const getEnvSecretsMock = vi.fn();

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: getEnvSecretsMock,
}));

const ENV = {
  STRIPE_FREE_SUBSCRIPTION_PRODUCT_ID: "prod_free",
  STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID: "prod_starter",
  STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID: "prod_standard",
  STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID: "prod_pro",
};

interface MockProductParams {
  credits?: number;
  interval?: "day" | "month" | "week" | "year";
  intervalCount?: number;
  planName: "free" | "starter" | "standard" | "pro";
  priceId: string;
  productId: string;
  unitAmount: number;
}

function createMockProduct(params: MockProductParams): unknown {
  return {
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
  };
}

describe("subscription-catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getEnvSecretsMock.mockReturnValue(ENV);
  });

  it("builds catalog from product metadata credits", async () => {
    const retrieveMock = vi.fn(async (productId: string) => {
      switch (productId) {
        case ENV.STRIPE_FREE_SUBSCRIPTION_PRODUCT_ID:
          return createMockProduct({
            planName: "free",
            priceId: "price_free",
            productId,
            credits: 250,
            unitAmount: 0,
          });
        case ENV.STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID:
          return createMockProduct({
            planName: "starter",
            priceId: "price_starter",
            productId,
            credits: 1750,
            unitAmount: 2500,
          });
        case ENV.STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID:
          return createMockProduct({
            planName: "standard",
            priceId: "price_standard",
            productId,
            credits: 5250,
            unitAmount: 7500,
          });
        case ENV.STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID:
          return createMockProduct({
            planName: "pro",
            priceId: "price_pro",
            productId,
            credits: 14000,
            unitAmount: 20000,
          });
        default:
          throw new Error(`Unexpected product id: ${productId}`);
      }
    });
    const stripe = {
      products: {
        retrieve: retrieveMock,
      },
    };

    const { getBetterAuthSubscriptionPlans, getSubscriptionCatalog } =
      await import("../subscription-catalog");

    const catalog = await getSubscriptionCatalog(stripe as never);
    expect(catalog.free.credits).toBe(250);
    expect(catalog.starter.credits).toBe(1750);
    expect(catalog.standard.monthlyAmount).toBe(7500);
    expect(catalog.pro.priceId).toBe("price_pro");
    expect(retrieveMock).toHaveBeenCalledTimes(4);

    const plans = await getBetterAuthSubscriptionPlans(stripe as never);
    expect(plans).toEqual([
      {
        limits: { credits: 250 },
        name: "free",
        priceId: "price_free",
      },
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

  it("throws when product metadata credits are missing", async () => {
    const retrieveMock = vi.fn(async (productId: string) => {
      switch (productId) {
        case ENV.STRIPE_FREE_SUBSCRIPTION_PRODUCT_ID:
          return createMockProduct({
            planName: "free",
            priceId: "price_free",
            productId,
            unitAmount: 0,
          });
        case ENV.STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID:
          return createMockProduct({
            planName: "starter",
            priceId: "price_starter",
            productId,
            credits: 1750,
            unitAmount: 2500,
          });
        case ENV.STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID:
          return createMockProduct({
            planName: "standard",
            priceId: "price_standard",
            productId,
            credits: 5250,
            unitAmount: 7500,
          });
        case ENV.STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID:
          return createMockProduct({
            planName: "pro",
            priceId: "price_pro",
            productId,
            credits: 14000,
            unitAmount: 20000,
          });
        default:
          throw new Error(`Unexpected product id: ${productId}`);
      }
    });

    const stripe = {
      products: {
        retrieve: retrieveMock,
      },
    };

    const { getSubscriptionCatalog } = await import("../subscription-catalog");

    await expect(getSubscriptionCatalog(stripe as never)).rejects.toThrow(
      "Missing credits metadata for free plan",
    );
  });
});
