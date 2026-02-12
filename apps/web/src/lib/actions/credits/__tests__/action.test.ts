jest.mock("server-only", () => ({}));
export {};

const getMyMemberInOrganizationMock = jest.fn();
const createStripeCheckoutSessionMock = jest.fn();
const getCreditsForCouponMock = jest.fn();
const claimCouponMock = jest.fn();
const getCreditTopUpPriceByCreditsMock = jest.fn();
const getBaseCreditTopUpPriceMock = jest.fn();

jest.mock("@/middleware/auth-middleware", () => ({
  withAuthContext:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

jest.mock("@/lib/services", () => ({
  userService: {
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
  },
}));

jest.mock("@/lib/services/stripe.service", () => ({
  stripeService: {
    createStripeCheckoutSession: (...args: unknown[]) =>
      createStripeCheckoutSessionMock(...args),
    getCreditsForCoupon: (...args: unknown[]) =>
      getCreditsForCouponMock(...args),
    claimCoupon: (...args: unknown[]) => claimCouponMock(...args),
  },
}));

jest.mock("@/lib/clients/stripe.client", () => ({
  stripeClient: {
    getCreditTopUpPriceByCredits: (...args: unknown[]) =>
      getCreditTopUpPriceByCreditsMock(...args),
    getBaseCreditTopUpPrice: (...args: unknown[]) =>
      getBaseCreditTopUpPriceMock(...args),
  },
}));

describe("credits actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves tiered price in purchaseCredits and passes it to checkout", async () => {
    getCreditTopUpPriceByCreditsMock.mockResolvedValue({
      id: "price_tiered",
      amountPerCredit: 15,
      currency: "eur",
    });
    createStripeCheckoutSessionMock.mockResolvedValue({
      url: "https://checkout.stripe.com/session/tiered",
    });

    const { purchaseCredits } = await import("../action");

    const result = await purchaseCredits({
      authContext: {
        userId: "user-1",
        organizationId: null,
      },
      organizationId: null,
      credits: 10_100,
    });

    expect(getCreditTopUpPriceByCreditsMock).toHaveBeenCalledWith(10_100);
    expect(createStripeCheckoutSessionMock).toHaveBeenCalledWith(
      "user-1",
      null,
      10_100,
      {
        id: "price_tiered",
        amountPerCredit: 15,
        currency: "eur",
      },
    );
    expect(result).toEqual({
      ok: true,
      data: { url: "https://checkout.stripe.com/session/tiered" },
    });
  });

  it("uses base tier price for coupon checkout regardless of coupon credits", async () => {
    getCreditsForCouponMock.mockResolvedValue(250_000);
    claimCouponMock.mockResolvedValue({
      id: "promo_1",
      active: true,
    });
    getBaseCreditTopUpPriceMock.mockResolvedValue({
      id: "price_base",
      amountPerCredit: 20,
      currency: "eur",
    });
    createStripeCheckoutSessionMock.mockResolvedValue({
      url: "https://checkout.stripe.com/session/coupon",
    });

    const { claimFreeCreditsWithCoupon } = await import("../action");

    const result = await claimFreeCreditsWithCoupon({
      authContext: {
        userId: "user-1",
        organizationId: null,
      },
      organizationId: null,
      couponId: "coupon_1",
    });

    expect(getBaseCreditTopUpPriceMock).toHaveBeenCalledTimes(1);
    expect(getCreditTopUpPriceByCreditsMock).not.toHaveBeenCalled();
    expect(createStripeCheckoutSessionMock).toHaveBeenCalledWith(
      "user-1",
      null,
      250_000,
      {
        id: "price_base",
        amountPerCredit: 20,
        currency: "eur",
      },
      "promo_1",
      "/coupon",
    );
    expect(result).toEqual({
      ok: true,
      data: { url: "https://checkout.stripe.com/session/coupon" },
    });
  });

  it("returns INVALID_CREDITS when credits are not a positive integer", async () => {
    const { CreditsErrorCode } = await import("@/lib/actions/errors");
    const { purchaseCredits } = await import("../action");

    const result = await purchaseCredits({
      authContext: {
        userId: "user-1",
        organizationId: null,
      },
      organizationId: null,
      credits: 1.5,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Invalid credits",
        code: CreditsErrorCode.INVALID_CREDITS,
      },
    });
    expect(getCreditTopUpPriceByCreditsMock).not.toHaveBeenCalled();
    expect(createStripeCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("returns UNAUTHORIZED for organization purchase when user is not a member", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { purchaseCredits } = await import("../action");
    getMyMemberInOrganizationMock.mockResolvedValue(null);

    const result = await purchaseCredits({
      authContext: {
        userId: "user-1",
        organizationId: "org-1",
      },
      organizationId: "org-1",
      credits: 100,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      },
    });
    expect(getCreditTopUpPriceByCreditsMock).not.toHaveBeenCalled();
    expect(createStripeCheckoutSessionMock).not.toHaveBeenCalled();
  });
});
