import { beforeEach, describe, expect, it, vi } from "vitest";

const { retrieveProductMock } = vi.hoisted(() => ({
  retrieveProductMock: vi.fn(),
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    retrieveProduct: (...args: unknown[]) => retrieveProductMock(...args),
  },
}));

import {
  getSubscriptionSeatCredits,
  invalidateSubscriptionSeatCreditsCache,
} from "./subscription-seat-credits.service";

function mockProducts(
  creditsByProductId: Record<string, string | undefined>,
): void {
  retrieveProductMock.mockImplementation(async (productId: string) => ({
    id: productId,
    metadata: { credits: creditsByProductId[productId] },
  }));
}

describe("getSubscriptionSeatCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateSubscriptionSeatCreditsCache();
  });

  it("resolves per-plan credits from Stripe product metadata", async () => {
    mockProducts({
      prod_starter_test: "1000",
      prod_standard_test: "4000",
      prod_pro_test: "10000",
    });

    await expect(getSubscriptionSeatCredits()).resolves.toEqual({
      pro: 10000,
      standard: 4000,
      starter: 1000,
    });
    expect(retrieveProductMock).toHaveBeenCalledWith("prod_starter_test");
    expect(retrieveProductMock).toHaveBeenCalledWith("prod_standard_test");
    expect(retrieveProductMock).toHaveBeenCalledWith("prod_pro_test");
  });

  it("caches the catalog across calls", async () => {
    mockProducts({
      prod_starter_test: "1000",
      prod_standard_test: "4000",
      prod_pro_test: "10000",
    });

    await getSubscriptionSeatCredits();
    await getSubscriptionSeatCredits();

    expect(retrieveProductMock).toHaveBeenCalledTimes(3);
  });

  it("does not cache failed loads and retries on the next call", async () => {
    retrieveProductMock.mockRejectedValueOnce(new Error("stripe down"));
    mockProducts({
      prod_starter_test: "1000",
      prod_standard_test: "4000",
      prod_pro_test: "10000",
    });
    retrieveProductMock.mockRejectedValueOnce(new Error("stripe down"));

    await expect(getSubscriptionSeatCredits()).rejects.toThrow("stripe down");
    await expect(getSubscriptionSeatCredits()).resolves.toEqual({
      pro: 10000,
      standard: 4000,
      starter: 1000,
    });
  });

  it("throws when credits metadata is missing", async () => {
    mockProducts({
      prod_starter_test: undefined,
      prod_standard_test: "4000",
      prod_pro_test: "10000",
    });

    await expect(getSubscriptionSeatCredits()).rejects.toThrow(
      "Missing credits metadata for starter plan",
    );
  });

  it("throws when credits metadata is not a positive integer", async () => {
    mockProducts({
      prod_starter_test: "1000",
      prod_standard_test: "-5",
      prod_pro_test: "10000",
    });

    await expect(getSubscriptionSeatCredits()).rejects.toThrow(
      "Invalid credits metadata for standard plan",
    );
  });
});
