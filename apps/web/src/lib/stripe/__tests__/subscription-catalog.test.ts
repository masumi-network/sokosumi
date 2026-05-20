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
  active?: boolean;
  credits?: number;
  interval?: "day" | "month" | "week" | "year";
  intervalCount?: number;
  planName: "enterprise" | "pro" | "standard" | "starter";
  priceId: string;
  productId: string;
  unitAmount: number;
}

function createMockProduct(params: MockProductParams): unknown {
  return {
    active: params.active ?? true,
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

function createMockStripe(params?: {
  listProducts?: unknown[];
  products?: Record<string, unknown>;
}) {
  const products = {
    ...createBaseProducts(),
    ...(params?.products ?? {}),
  };
  const listMock = vi.fn(async () => ({
    data: params?.listProducts ?? [],
    has_more: false,
  }));
  const retrieveMock = vi.fn(async (productId: string) => {
    const product = products[productId];
    if (!product) {
      throw new Error(`Unexpected product id: ${productId}`);
    }

    return product;
  });

  return {
    listMock,
    retrieveMock,
    stripe: {
      products: {
        list: listMock,
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
    const { listMock, retrieveMock, stripe } = createMockStripe();

    const { getBetterAuthSubscriptionPlans, getSubscriptionCatalog } =
      await import("../subscription-catalog");

    const catalog = await getSubscriptionCatalog(stripe as never);
    expect(catalog.free.credits).toBe(250);
    expect(catalog.free.productId).toBe("local-free");
    expect(catalog.free.monthlyAmount).toBe(0);
    expect(catalog.starter.credits).toBe(1750);
    expect(catalog.standard.monthlyAmount).toBe(7500);
    expect(catalog.pro.priceId).toBe("price_pro");
    expect(catalog.enterpriseProducts).toEqual([]);
    expect(listMock).toHaveBeenCalledWith({ active: true, limit: 100 });
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

  it("discovers enterprise products by metadata and exposes one Better Auth plan per product", async () => {
    const enterpriseProducts = {
      prod_enterprise_a: createMockProduct({
        planName: "enterprise",
        priceId: "price_enterprise_a",
        productId: "prod_enterprise_a",
        credits: 50000,
        unitAmount: 120000,
      }),
      prod_enterprise_b: createMockProduct({
        planName: "enterprise",
        priceId: "price_enterprise_b",
        productId: "prod_enterprise_b",
        credits: 75000,
        unitAmount: 180000,
      }),
    };
    const { retrieveMock, stripe } = createMockStripe({
      listProducts: [
        { id: "prod_enterprise_a", metadata: { slug: " enterprise " } },
        { id: "prod_ignored", metadata: { slug: "starter" } },
        { id: "prod_enterprise_b", metadata: { slug: "ENTERPRISE" } },
      ],
      products: enterpriseProducts,
    });

    const { getBetterAuthSubscriptionPlans, getSubscriptionCatalog } =
      await import("../subscription-catalog");

    const catalog = await getSubscriptionCatalog(stripe as never);
    expect(catalog.enterpriseProducts).toEqual([
      expect.objectContaining({
        credits: 50000,
        monthlyAmount: 120000,
        priceId: "price_enterprise_a",
        productId: "prod_enterprise_a",
      }),
      expect.objectContaining({
        credits: 75000,
        monthlyAmount: 180000,
        priceId: "price_enterprise_b",
        productId: "prod_enterprise_b",
      }),
    ]);
    expect(retrieveMock).toHaveBeenCalledWith("prod_enterprise_a", {
      expand: ["default_price"],
    });
    expect(retrieveMock).toHaveBeenCalledWith("prod_enterprise_b", {
      expand: ["default_price"],
    });

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
      {
        limits: { credits: 50000 },
        name: "enterprise",
        priceId: "price_enterprise_a",
      },
      {
        limits: { credits: 75000 },
        name: "enterprise",
        priceId: "price_enterprise_b",
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

  it("throws when discovered enterprise metadata is invalid", async () => {
    const { stripe } = createMockStripe({
      listProducts: [
        {
          id: "prod_enterprise",
          metadata: { slug: "enterprise" },
        },
      ],
      products: {
        prod_enterprise: createMockProduct({
          planName: "enterprise",
          priceId: "price_enterprise",
          productId: "prod_enterprise",
          unitAmount: 120000,
        }),
      },
    });

    const { getSubscriptionCatalog } = await import("../subscription-catalog");

    await expect(getSubscriptionCatalog(stripe as never)).rejects.toThrow(
      "Missing credits metadata for enterprise plan",
    );
  });

  it("invalidates the cached catalog on demand", async () => {
    const { listMock, stripe } = createMockStripe();

    const { getSubscriptionCatalog, invalidateSubscriptionCatalogCache } =
      await import("../subscription-catalog");

    await getSubscriptionCatalog(stripe as never);
    await getSubscriptionCatalog(stripe as never);
    expect(listMock).toHaveBeenCalledTimes(1);

    invalidateSubscriptionCatalogCache();

    await getSubscriptionCatalog(stripe as never);
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("resolves a valid enterprise product and returns null for invalid products", async () => {
    const { stripe } = createMockStripe({
      products: {
        prod_enterprise: createMockProduct({
          planName: "enterprise",
          priceId: "price_enterprise",
          productId: "prod_enterprise",
          credits: 50000,
          unitAmount: 120000,
        }),
        prod_invalid_enterprise: createMockProduct({
          planName: "enterprise",
          priceId: "price_invalid_enterprise",
          productId: "prod_invalid_enterprise",
          unitAmount: 120000,
        }),
        prod_standard_named: createMockProduct({
          planName: "standard",
          priceId: "price_standard_named",
          productId: "prod_standard_named",
          credits: 5250,
          unitAmount: 7500,
        }),
      },
    });

    const { resolveEnterpriseProduct } = await import(
      "../subscription-catalog"
    );

    await expect(
      resolveEnterpriseProduct(stripe as never, "prod_enterprise"),
    ).resolves.toEqual(
      expect.objectContaining({
        credits: 50000,
        monthlyAmount: 120000,
        productId: "prod_enterprise",
      }),
    );
    await expect(
      resolveEnterpriseProduct(stripe as never, "prod_invalid_enterprise"),
    ).resolves.toBeNull();
    await expect(
      resolveEnterpriseProduct(stripe as never, "prod_standard_named"),
    ).resolves.toBeNull();
  });
});
