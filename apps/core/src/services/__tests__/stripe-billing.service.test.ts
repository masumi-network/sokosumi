import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const userUpdateMock = vi.fn();
const organizationFindManyMock = vi.fn();
const organizationFindUniqueMock = vi.fn();
const organizationUpdateMock = vi.fn();
const getPriceByLookupKeyMock = vi.fn();
const getPricesByLookupKeysMock = vi.fn();
const getCreditTopUpPriceByCreditsMock = vi.fn();
const createCreditCheckoutSessionMock = vi.fn();
const getCheckoutSessionMock = vi.fn();
const getPromotionCodeByIdMock = vi.fn();
const getCouponByIdMock = vi.fn();
const getPromotionCodeMock = vi.fn();
const createPromotionCodeMock = vi.fn();
const createUserCustomerMock = vi.fn();
const resolveOrganizationBillingPlanMock = vi.fn();
const resolveActiveSubscriptionByReferenceIdMock = vi.fn();

vi.mock("@sokosumi/database/helpers", () => ({
  resolveOrganizationBillingPlan: (...args: unknown[]) =>
    resolveOrganizationBillingPlanMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => userUpdateMock(...args),
    },
    organization: {
      findMany: (...args: unknown[]) => organizationFindManyMock(...args),
      findUnique: (...args: unknown[]) => organizationFindUniqueMock(...args),
      update: (...args: unknown[]) => organizationUpdateMock(...args),
    },
  },
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    getPriceByLookupKey: (...args: unknown[]) =>
      getPriceByLookupKeyMock(...args),
    getPricesByLookupKeys: (...args: unknown[]) =>
      getPricesByLookupKeysMock(...args),
    getCreditTopUpPriceByCredits: (...args: unknown[]) =>
      getCreditTopUpPriceByCreditsMock(...args),
    createCreditCheckoutSession: (...args: unknown[]) =>
      createCreditCheckoutSessionMock(...args),
    getCheckoutSession: (...args: unknown[]) => getCheckoutSessionMock(...args),
    getPromotionCodeById: (...args: unknown[]) =>
      getPromotionCodeByIdMock(...args),
    getCouponById: (...args: unknown[]) => getCouponByIdMock(...args),
    getPromotionCode: (...args: unknown[]) => getPromotionCodeMock(...args),
    createPromotionCode: (...args: unknown[]) =>
      createPromotionCodeMock(...args),
    createUserCustomer: (...args: unknown[]) => createUserCustomerMock(...args),
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
  // Default to an active paid plan so the free-plan purchase gate is a no-op
  // unless a test opts into the free plan explicitly.
  resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
    plan: "starter",
  });
  resolveOrganizationBillingPlanMock.mockResolvedValue({ plan: "starter" });
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
  getPricesByLookupKeysMock.mockImplementation(async (lookupKeys: string[]) => {
    const map: Record<string, number> = {
      credit_20_margin: 120,
      credit_15_margin: 115,
      credit_10_margin: 110,
    };
    return new Map(lookupKeys.map((key) => [key, PRICE(map[key])]));
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
    // Tiers are resolved in a single batched lookup, not one call per tier.
    expect(getPricesByLookupKeysMock).toHaveBeenCalledWith([
      "credit_20_margin",
      "credit_15_margin",
      "credit_10_margin",
    ]);
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
          percent_off: 100,
          metadata: { credits: "1000", ttl_days: "30" },
        },
      },
    });

    await stripeBillingService.createCreditCheckoutSession({
      userId: "user_1",
      organizationId: null,
      credits: 1000,
      promotionCodeId: "promo_1",
    });

    expect(createCreditCheckoutSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        promotionCodeId: "promo_1",
        couponTtlDays: "30",
      }),
    );
  });

  it("re-derives credits from the coupon and ignores an inflated client value", async () => {
    getPromotionCodeByIdMock.mockResolvedValue({
      id: "promo_1",
      customer: "cus_123",
      promotion: {
        coupon: {
          id: "coupon_1",
          percent_off: 100,
          metadata: { credits: "1000" },
        },
      },
    });

    await stripeBillingService.createCreditCheckoutSession({
      userId: "user_1",
      organizationId: null,
      credits: 9_999_999,
      promotionCodeId: "promo_1",
    });

    // Price is computed for the coupon's credits, not the client's value.
    expect(getCreditTopUpPriceByCreditsMock).toHaveBeenCalledWith(
      1000,
      undefined,
    );
    expect(createCreditCheckoutSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ credits: 1000 }),
    );
  });

  it("rejects a promotion code whose coupon has no credit metadata", async () => {
    getPromotionCodeByIdMock.mockResolvedValue({
      id: "promo_1",
      customer: "cus_123",
      promotion: {
        coupon: {
          id: "coupon_1",
          percent_off: 100,
          metadata: {},
        },
      },
    });

    await expect(
      stripeBillingService.createCreditCheckoutSession({
        userId: "user_1",
        organizationId: null,
        credits: 1000,
        promotionCodeId: "promo_1",
      }),
    ).rejects.toThrow("Invalid promotion code");

    expect(createCreditCheckoutSessionMock).not.toHaveBeenCalled();
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

describe("createCreditCheckoutSession free-plan gate", () => {
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

  it("rejects a paid purchase for a personal free-plan account", async () => {
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);

    await expect(
      stripeBillingService.createCreditCheckoutSession({
        userId: "user_1",
        organizationId: null,
        credits: 5_000,
      }),
    ).rejects.toThrow("Credit purchases require an active subscription");

    expect(createCreditCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("rejects a paid purchase for an organization on the free plan", async () => {
    organizationFindUniqueMock.mockResolvedValue({
      id: "org_1",
      name: "Org",
      slug: "org",
      stripeCustomerId: "cus_123",
      metadata: {},
    });
    resolveOrganizationBillingPlanMock.mockResolvedValue({ plan: "free" });

    await expect(
      stripeBillingService.createCreditCheckoutSession({
        userId: "user_1",
        organizationId: "org_1",
        credits: 5_000,
      }),
    ).rejects.toThrow("Credit purchases require an active subscription");

    expect(createCreditCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("allows a free-plan purchase for a zero-margin account", async () => {
    findUniqueMock.mockResolvedValue({
      email: "alice@nmkr.io",
      stripeCustomerId: "cus_123",
    });
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);

    await stripeBillingService.createCreditCheckoutSession({
      userId: "user_2",
      organizationId: null,
      credits: 5_000,
    });

    expect(getCreditTopUpPriceByCreditsMock).toHaveBeenCalledWith(
      5_000,
      "credit_0_margin",
    );
    expect(createCreditCheckoutSessionMock).toHaveBeenCalled();
  });

  it("exempts coupon redemptions from the free-plan gate", async () => {
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);
    getPromotionCodeByIdMock.mockResolvedValue({
      id: "promo_1",
      customer: "cus_123",
      promotion: {
        coupon: {
          id: "coupon_1",
          percent_off: 100,
          metadata: { credits: "1000" },
        },
      },
    });

    await stripeBillingService.createCreditCheckoutSession({
      userId: "user_1",
      organizationId: null,
      credits: 1000,
      promotionCodeId: "promo_1",
    });

    expect(createCreditCheckoutSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ credits: 1000, promotionCodeId: "promo_1" }),
    );
  });
});

describe("claimCoupon validation", () => {
  beforeEach(() => {
    findUniqueMock.mockResolvedValue({
      email: "bob@example.com",
      stripeCustomerId: "cus_123",
    });
    getPromotionCodeMock.mockResolvedValue(null);
    createPromotionCodeMock.mockResolvedValue({ id: "promo_1", active: true });
  });

  it("claims a valid credit coupon", async () => {
    getCouponByIdMock.mockResolvedValue({
      id: "coupon_1",
      percent_off: 100,
      metadata: { credits: "100" },
    });

    const result = await stripeBillingService.claimCoupon({
      userId: "user_1",
      organizationId: null,
      couponId: "coupon_1",
    });

    expect(result).toEqual({ promotionCodeId: "promo_1", active: true });
    expect(createPromotionCodeMock).toHaveBeenCalled();
  });

  it("rejects an unknown coupon without minting a promotion code", async () => {
    getCouponByIdMock.mockResolvedValue(null);

    await expect(
      stripeBillingService.claimCoupon({
        userId: "user_1",
        organizationId: null,
        couponId: "coupon_missing",
      }),
    ).rejects.toThrow("Coupon not found");

    expect(createPromotionCodeMock).not.toHaveBeenCalled();
  });

  it("rejects a non-credit coupon without minting a promotion code", async () => {
    getCouponByIdMock.mockResolvedValue({
      id: "coupon_1",
      percent_off: 100,
      metadata: {},
    });

    await expect(
      stripeBillingService.claimCoupon({
        userId: "user_1",
        organizationId: null,
        couponId: "coupon_1",
      }),
    ).rejects.toThrow();

    expect(createPromotionCodeMock).not.toHaveBeenCalled();
  });

  it("persists a newly created user Stripe customer id (write-through)", async () => {
    findUniqueMock.mockResolvedValue({
      id: "user_1",
      name: "Bob",
      email: "bob@example.com",
      stripeCustomerId: null,
    });
    createUserCustomerMock.mockResolvedValue({ id: "cus_new" });
    getCouponByIdMock.mockResolvedValue({
      id: "coupon_1",
      percent_off: 100,
      metadata: { credits: "100" },
    });

    await stripeBillingService.claimCoupon({
      userId: "user_1",
      organizationId: null,
      couponId: "coupon_1",
    });

    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { stripeCustomerId: "cus_new" },
    });
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
