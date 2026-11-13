import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  listPolarProducts: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@/clients/polar.client", () => ({
  listPolarProducts: m.listPolarProducts,
}));
vi.mock("@sentry/node", () => ({ captureMessage: m.captureMessage }));

interface ProductOverrides {
  interval?: string | null;
  intervalCount?: number | null;
  metadata?: Record<string, string | number | boolean>;
  prices?: unknown[];
}

function product(id: string, amount: number, overrides: ProductOverrides) {
  const interval = overrides.interval ?? null;
  return {
    id,
    name: `Product ${id}`,
    is_archived: false,
    is_recurring: interval !== null,
    recurring_interval: interval,
    recurring_interval_count:
      overrides.intervalCount ?? (interval === null ? null : 1),
    metadata: overrides.metadata ?? {},
    prices: overrides.prices ?? [
      {
        id: `price_${id}`,
        amount_type: "fixed",
        price_amount: amount,
        price_currency: "usd",
        is_archived: false,
      },
    ],
  };
}

function plan(
  id: string,
  tier: string,
  interval: "month" | "year",
  credits: number,
  amount: number,
) {
  return product(id, amount, {
    interval,
    metadata: { kind: "plan", tier, credits: String(credits) },
  });
}

function pack(id: string, credits: number, amount: number) {
  return product(id, amount, { metadata: { kind: "top-up", credits } });
}

// ADR 0068's price list.
const PRODUCTS = [
  plan("p_large_y", "large", "year", 50000, 1000000),
  plan("p_small_m", "small", "month", 10000, 20000),
  plan("p_medium_m", "medium", "month", 25000, 50000),
  plan("p_large_m", "large", "month", 50000, 100000),
  plan("p_small_y", "small", "year", 10000, 200000),
  plan("p_medium_y", "medium", "year", 25000, 500000),
  pack("t_25", 25000, 75000),
  pack("t_5", 5000, 15000),
  pack("t_10", 10000, 30000),
];

async function getCatalog() {
  const { getCmoCatalog } = await import("./cmo-catalog.service");
  return getCmoCatalog();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  m.listPolarProducts.mockResolvedValue(PRODUCTS);
});

describe("getCmoCatalog", () => {
  it("lists six plans and three packs from product metadata", async () => {
    const catalog = await getCatalog();

    expect(catalog.plans).toEqual([
      {
        productId: "p_small_m",
        name: "Product p_small_m",
        tier: "small",
        interval: "month",
        credits: 10000,
        priceAmount: 20000,
        currency: "usd",
      },
      expect.objectContaining({ productId: "p_medium_m", credits: 25000 }),
      expect.objectContaining({ productId: "p_large_m", credits: 50000 }),
      expect.objectContaining({
        productId: "p_small_y",
        interval: "year",
        credits: 10000,
        priceAmount: 200000,
      }),
      expect.objectContaining({ productId: "p_medium_y", tier: "medium" }),
      expect.objectContaining({ productId: "p_large_y", tier: "large" }),
    ]);
    expect(catalog.topUps).toEqual([
      {
        productId: "t_5",
        name: "Product t_5",
        credits: 5000,
        priceAmount: 15000,
        currency: "usd",
      },
      expect.objectContaining({ productId: "t_10", credits: 10000 }),
      expect.objectContaining({ productId: "t_25", credits: 25000 }),
    ]);
    expect(m.captureMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["no kind", product("bad", 100, { metadata: { credits: 100 } })],
    [
      "an unknown kind",
      product("bad", 100, { metadata: { kind: "seat", credits: 100 } }),
    ],
    [
      "a plan without a tier",
      product("bad", 100, {
        interval: "month",
        metadata: { kind: "plan", credits: 100 },
      }),
    ],
    [
      "credits that are not a positive whole number",
      product("bad", 100, { metadata: { kind: "top-up", credits: "1.5" } }),
    ],
    [
      "a plan that does not recur",
      product("bad", 100, {
        metadata: { kind: "plan", tier: "small", credits: 100 },
      }),
    ],
    [
      "a plan billed every week",
      product("bad", 100, {
        interval: "week",
        metadata: { kind: "plan", tier: "small", credits: 100 },
      }),
    ],
    [
      "a plan billed every second month",
      product("bad", 100, {
        interval: "month",
        intervalCount: 2,
        metadata: { kind: "plan", tier: "small", credits: 100 },
      }),
    ],
    [
      "a pack that recurs",
      product("bad", 100, {
        interval: "month",
        metadata: { kind: "top-up", credits: 100 },
      }),
    ],
    [
      "no fixed price",
      product("bad", 100, {
        metadata: { kind: "top-up", credits: 100 },
        prices: [{ id: "price_bad", amount_type: "custom" }],
      }),
    ],
  ])("ignores and reports a product with %s", async (_name, bad) => {
    m.listPolarProducts.mockResolvedValue([...PRODUCTS, bad]);

    const catalog = await getCatalog();

    expect(catalog.plans).toHaveLength(6);
    expect(catalog.topUps).toHaveLength(3);
    expect(m.captureMessage).toHaveBeenCalledTimes(1);
    expect(m.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        extra: expect.objectContaining({ productId: "bad" }),
      }),
    );
  });

  it("reads Polar once per process", async () => {
    const { getCmoCatalog } = await import("./cmo-catalog.service");

    await getCmoCatalog();
    await getCmoCatalog();

    expect(m.listPolarProducts).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed read", async () => {
    const { getCmoCatalog } = await import("./cmo-catalog.service");
    m.listPolarProducts.mockRejectedValueOnce(new Error("Polar is down"));

    await expect(getCmoCatalog()).rejects.toThrow("Polar is down");

    await expect(getCmoCatalog()).resolves.toMatchObject({
      plans: expect.any(Array),
    });
  });
});
