import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const organizationFindManyMock = vi.fn();
const organizationFindUniqueMock = vi.fn();
const getPriceByLookupKeyMock = vi.fn();
const getCreditTopUpPriceByCreditsMock = vi.fn();
const createCreditCheckoutSessionMock = vi.fn();
const getCheckoutSessionMock = vi.fn();
const getPromotionCodeByIdMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    organization: {
      findMany: (...args: unknown[]) => organizationFindManyMock(...args),
      findUnique: (...args: unknown[]) => organizationFindUniqueMock(...args),
    },
  },
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    getPriceByLookupKey: (...args: unknown[]) =>
      getPriceByLookupKeyMock(...args),
    getCreditTopUpPriceByCredits: (...args: unknown[]) =>
      getCreditTopUpPriceByCreditsMock(...args),
    createCreditCheckoutSession: (...args: unknown[]) =>
      createCreditCheckoutSessionMock(...args),
    getCheckoutSession: (...args: unknown[]) => getCheckoutSessionMock(...args),
    getPromotionCodeById: (...args: unknown[]) =>
      getPromotionCodeByIdMock(...args),
  },
}));

import { stripeBillingService } from "../stripe-billing.service";

const PRICE = (amountPerCredit: number) => ({
  id: `price_${amountPerCredit}`,
  amountPerCredit,
  currency: "eur",
});

beforeEach(() => {
  vi.clearAllMocks();
  organizationFindManyMock.mockResolvedValue([]);
  // Standard prices keyed by lookup key.
  getPriceByLookupKeyMock.mockImplementation(async (lookupKey: string) => {
    const map: Record<string, number> = {
      credit_20_margin: 120,
      credit_15_margin: 115,
      credit_10_margin: 110,
      credit_0_margin: 100,
    };
    return PRICE(map[lookupKey]);
  });
});

describe("getCreditTopUpPricing", () => {
  it("returns the three standard tiers for a non-allowlisted user", async () => {
    findUniqueMock.mockResolvedValue({ email: "bob@example.com" });

    const pricing = await stripeBillingService.getCreditTopUpPricing("user_1");

    expect(pricing.canPurchaseOnFreePlan).toBe(false);
    expect(pricing.currency).toBe("eur");
    expect(pricing.tiers).toEqual([
      { minCredits: 1, amountPerCredit: 120 },
      { minCredits: 10_000, amountPerCredit: 115 },
      { minCredits: 100_000, amountPerCredit: 110 },
    ]);
    expect(pricing.referenceAmountPerCredit).toBe(120);
    expect(getPriceByLookupKeyMock).not.toHaveBeenCalledWith("credit_0_margin");
  });

  it("returns a single zero-margin tier for an allowlisted user", async () => {
    findUniqueMock.mockResolvedValue({ email: "alice@nmkr.io" });

    const pricing = await stripeBillingService.getCreditTopUpPricing("user_2");

    expect(pricing.canPurchaseOnFreePlan).toBe(true);
    expect(pricing.tiers).toEqual([{ minCredits: 1, amountPerCredit: 100 }]);
    expect(pricing.referenceAmountPerCredit).toBe(100);
    expect(getPriceByLookupKeyMock).toHaveBeenCalledWith("credit_0_margin");
  });
});

describe("createCreditCheckoutSession pricing authority", () => {
  beforeEach(() => {
    findUniqueMock.mockResolvedValue({
      email: "bob@example.com",
      stripeCustomerId: "cus_123",
    });
    getCreditTopUpPriceByCreditsMock.mockResolvedValue(PRICE(120));
    createCreditCheckoutSessionMock.mockResolvedValue({
      url: "https://checkout.stripe.com/x",
    });
  });

  it("prices a non-allowlisted user from the volume curve (no zero-margin key)", async () => {
    await stripeBillingService.createCreditCheckoutSession({
      userId: "user_1",
      organizationId: null,
      credits: 5_000,
    });

    expect(getCreditTopUpPriceByCreditsMock).toHaveBeenCalledWith(
      5_000,
      undefined,
    );
  });

  it("prices an allowlisted user with the zero-margin key, regardless of input", async () => {
    findUniqueMock.mockResolvedValue({
      email: "alice@nmkr.io",
      stripeCustomerId: "cus_123",
    });

    await stripeBillingService.createCreditCheckoutSession({
      userId: "user_2",
      organizationId: null,
      credits: 5_000,
    });

    expect(getCreditTopUpPriceByCreditsMock).toHaveBeenCalledWith(
      5_000,
      "credit_0_margin",
    );
  });

  it("derives checkout ttl_days from the claimed Stripe promotion code", async () => {
    getPromotionCodeByIdMock.mockResolvedValue({
      id: "promo_1",
      customer: "cus_123",
      promotion: {
        coupon: {
          id: "coupon_1",
          metadata: { ttl_days: "30" },
        },
      },
    });

    await stripeBillingService.createCreditCheckoutSession({
      userId: "user_1",
      organizationId: null,
      credits: 500,
      promotionCodeId: "promo_1",
    });

    expect(createCreditCheckoutSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        promotionCodeId: "promo_1",
        couponTtlDays: "30",
      }),
    );
  });

  it("rejects promotion codes scoped to another Stripe customer", async () => {
    getPromotionCodeByIdMock.mockResolvedValue({
      id: "promo_1",
      customer: "cus_other",
      promotion: {
        coupon: {
          id: "coupon_1",
          metadata: { ttl_days: "30" },
        },
      },
    });

    await expect(
      stripeBillingService.createCreditCheckoutSession({
        userId: "user_1",
        organizationId: null,
        credits: 500,
        promotionCodeId: "promo_1",
      }),
    ).rejects.toThrow("Invalid promotion code");

    expect(createCreditCheckoutSessionMock).not.toHaveBeenCalled();
  });
});

describe("getCheckoutSessionAnalytics ownership", () => {
  beforeEach(() => {
    getCheckoutSessionMock.mockResolvedValue({
      id: "cs_123",
      amount_total: 12000,
      currency: "eur",
      customer: "cus_user",
      line_items: { data: [] },
      metadata: {},
    });
  });

  it("returns analytics for a checkout session owned by the user customer", async () => {
    findUniqueMock.mockResolvedValue({ stripeCustomerId: "cus_user" });

    const analytics = await stripeBillingService.getCheckoutSessionAnalytics(
      "cs_123",
      "user_1",
    );

    expect(analytics).toMatchObject({
      sessionId: "cs_123",
      currency: "eur",
      value: 12000,
    });
  });

  it("returns analytics for a checkout session owned by a member organization", async () => {
    findUniqueMock.mockResolvedValue({ stripeCustomerId: "cus_other" });
    organizationFindManyMock.mockResolvedValue([
      { stripeCustomerId: "cus_org" },
    ]);
    getCheckoutSessionMock.mockResolvedValue({
      id: "cs_123",
      amount_total: 12000,
      currency: "eur",
      customer: "cus_org",
      line_items: { data: [] },
      metadata: {},
    });

    await expect(
      stripeBillingService.getCheckoutSessionAnalytics("cs_123", "user_1"),
    ).resolves.toMatchObject({ sessionId: "cs_123" });
  });

  it("rejects checkout session analytics when the customer is not owned by the caller", async () => {
    findUniqueMock.mockResolvedValue({ stripeCustomerId: "cus_other" });

    await expect(
      stripeBillingService.getCheckoutSessionAnalytics("cs_123", "user_1"),
    ).rejects.toThrow("Checkout session not found");
  });
});
