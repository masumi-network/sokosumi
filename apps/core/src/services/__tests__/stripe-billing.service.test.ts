import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const getPriceByLookupKeyMock = vi.fn();
const getCreditTopUpPriceByCreditsMock = vi.fn();
const createCreditCheckoutSessionMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    organization: { findUnique: vi.fn() },
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
  });

  it("returns a single zero-margin tier for an allowlisted user", async () => {
    findUniqueMock.mockResolvedValue({ email: "alice@nmkr.io" });

    const pricing = await stripeBillingService.getCreditTopUpPricing("user_2");

    expect(pricing.canPurchaseOnFreePlan).toBe(true);
    expect(pricing.tiers).toEqual([{ minCredits: 1, amountPerCredit: 100 }]);
    expect(pricing.referenceAmountPerCredit).toBe(100);
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
});
