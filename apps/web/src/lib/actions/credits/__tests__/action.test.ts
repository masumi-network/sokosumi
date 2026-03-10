jest.mock("server-only", () => ({}));
export {};

const getMyMemberInOrganizationMock = jest.fn();
const createStripeCheckoutSessionMock = jest.fn();
const getCouponMock = jest.fn();
const claimCouponMock = jest.fn();
const getCreditTopUpPriceByCreditsMock = jest.fn();
const getBaseCreditTopUpPriceMock = jest.fn();

jest.mock("@/middleware/auth-middleware", () => ({
  withSession:
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
    getCoupon: (...args: unknown[]) => getCouponMock(...args),
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
  const session = {
    user: {
      id: "user-1",
    },
    session: {
      activeOrganizationId: null,
    },
  } as never;

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
      session,
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
      null,
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      data: { url: "https://checkout.stripe.com/session/tiered" },
    });
  });

  it("uses the lookup key override in purchaseCredits", async () => {
    getCreditTopUpPriceByCreditsMock.mockResolvedValue({
      id: "price_zero_margin",
      amountPerCredit: 10,
      currency: "eur",
    });
    createStripeCheckoutSessionMock.mockResolvedValue({
      url: "https://checkout.stripe.com/session/zero-margin",
    });

    const { purchaseCredits } = await import("../action");

    const result = await purchaseCredits({
      session,
      organizationId: null,
      credits: 250_000,
      priceLookupKeyOverride: "credit_0_margin",
      returnPath: "/billing/top-up-secret",
    });

    expect(getCreditTopUpPriceByCreditsMock).toHaveBeenCalledWith(
      250_000,
      "credit_0_margin",
    );
    expect(createStripeCheckoutSessionMock).toHaveBeenCalledWith(
      "user-1",
      null,
      250_000,
      {
        id: "price_zero_margin",
        amountPerCredit: 10,
        currency: "eur",
      },
      null,
      "/billing/top-up-secret",
    );
    expect(result).toEqual({
      ok: true,
      data: { url: "https://checkout.stripe.com/session/zero-margin" },
    });
  });

  it("uses base tier price for coupon checkout regardless of coupon credits", async () => {
    getCouponMock.mockResolvedValue({
      id: "coupon_1",
      metadata: {
        credits: "250000",
        ttl_days: "90",
      },
      percent_off: 100,
    });
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
      session,
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
      "90",
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
      session,
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
      session,
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
