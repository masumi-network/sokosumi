import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

export {};

const getMyMemberInOrganizationMock = vi.fn();
const createCreditCheckoutSessionMock = vi.fn();
const getCouponDetailsMock = vi.fn();
const claimCouponMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "https://app.sokosumi.test" }),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

vi.mock("@/lib/services", () => ({
  userService: {
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
  },
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    createCreditCheckoutSession: (...args: unknown[]) =>
      createCreditCheckoutSessionMock(...args),
    getCouponDetails: (...args: unknown[]) => getCouponDetailsMock(...args),
    claimCoupon: (...args: unknown[]) => claimCouponMock(...args),
  },
}));

describe("credits actions", () => {
  const session = {
    user: {
      email: "member@example.com",
      id: "user-1",
    },
    session: {
      activeOrganizationId: null,
    },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates checkout via Core in purchaseCredits", async () => {
    createCreditCheckoutSessionMock.mockResolvedValue({
      data: { url: "https://checkout.stripe.com/session/tiered" },
    });

    const { purchaseCredits } = await import("../action");

    const result = await purchaseCredits({
      session,
      organizationId: null,
      credits: 10_100,
    });

    expect(createCreditCheckoutSessionMock).toHaveBeenCalledWith({
      organizationId: null,
      credits: 10_100,
      returnPath: undefined,
      origin: "https://app.sokosumi.test",
    });
    expect(result).toEqual({
      ok: true,
      data: { url: "https://checkout.stripe.com/session/tiered" },
    });
  });

  it("passes returnPath to the checkout session when provided", async () => {
    createCreditCheckoutSessionMock.mockResolvedValue({
      data: { url: "https://checkout.stripe.com/session/tiered" },
    });

    const { purchaseCredits } = await import("../action");

    const result = await purchaseCredits({
      session,
      organizationId: null,
      credits: 250_000,
      returnPath: "/billing?tab=credits",
    });

    expect(createCreditCheckoutSessionMock).toHaveBeenCalledWith({
      organizationId: null,
      credits: 250_000,
      returnPath: "/billing?tab=credits",
      origin: "https://app.sokosumi.test",
    });
    expect(result).toEqual({
      ok: true,
      data: { url: "https://checkout.stripe.com/session/tiered" },
    });
  });

  it("claims coupon and creates checkout via Core", async () => {
    getCouponDetailsMock.mockResolvedValue({
      data: {
        id: "coupon_1",
        credits: 250_000,
        percentOff: 100,
        ttlDays: "90",
      },
    });
    claimCouponMock.mockResolvedValue({
      data: {
        promotionCodeId: "promo_1",
        active: true,
      },
    });
    createCreditCheckoutSessionMock.mockResolvedValue({
      data: { url: "https://checkout.stripe.com/session/coupon" },
    });

    const { claimFreeCreditsWithCoupon } = await import("../action");

    const result = await claimFreeCreditsWithCoupon({
      session,
      organizationId: null,
      couponId: "coupon_1",
    });

    expect(getCouponDetailsMock).toHaveBeenCalledWith("coupon_1");
    expect(claimCouponMock).toHaveBeenCalledWith("coupon_1", {
      organizationId: null,
    });
    expect(createCreditCheckoutSessionMock).toHaveBeenCalledWith({
      organizationId: null,
      credits: 250_000,
      promotionCodeId: "promo_1",
      returnPath: "/coupon",
      ttlDays: "90",
      origin: "https://app.sokosumi.test",
    });
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
    expect(createCreditCheckoutSessionMock).not.toHaveBeenCalled();
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
    expect(createCreditCheckoutSessionMock).not.toHaveBeenCalled();
  });
});
