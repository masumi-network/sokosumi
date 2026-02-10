jest.mock("server-only", () => ({}));

const headersMock = jest.fn(async () => new Headers());
const upgradeSubscriptionMock = jest.fn();
const createBillingPortalMock = jest.fn();

jest.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));

jest.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      createBillingPortal: (...args: unknown[]) =>
        createBillingPortalMock(...args),
      upgradeSubscription: (...args: unknown[]) =>
        upgradeSubscriptionMock(...args),
    },
  },
}));

describe("subscription actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns BAD_INPUT for invalid plan names", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { upgradePersonalSubscription } = await import("../action");

    const result = await upgradePersonalSubscription({
      authContext: {
        organizationId: null,
        userId: "user-1",
      },
      plan: "enterprise" as never,
    });

    expect(result).toEqual({
      error: {
        code: CommonErrorCode.BAD_INPUT,
      },
      ok: false,
    });
    expect(upgradeSubscriptionMock).not.toHaveBeenCalled();
  });

  it("returns checkout url from better-auth upgradeSubscription", async () => {
    upgradeSubscriptionMock.mockResolvedValue({
      url: "https://checkout.stripe.com/session/test",
    });

    const { upgradePersonalSubscription } = await import("../action");

    const result = await upgradePersonalSubscription({
      authContext: {
        organizationId: null,
        userId: "user-1",
      },
      plan: "starter",
    });

    expect(result).toEqual({
      data: { url: "https://checkout.stripe.com/session/test" },
      ok: true,
    });
    expect(upgradeSubscriptionMock).toHaveBeenCalledWith({
      body: {
        cancelUrl: "/subscriptions?status=cancel",
        customerType: "user",
        disableRedirect: true,
        plan: "starter",
        returnUrl: "/subscriptions",
        successUrl: "/subscriptions?status=success",
      },
      headers: new Headers(),
    });
  });

  it("allows downgrading to free via better-auth upgradeSubscription", async () => {
    upgradeSubscriptionMock.mockResolvedValue({
      url: "https://checkout.stripe.com/session/free",
    });

    const { upgradePersonalSubscription } = await import("../action");

    const result = await upgradePersonalSubscription({
      authContext: {
        organizationId: null,
        userId: "user-1",
      },
      plan: "free",
    });

    expect(result).toEqual({
      data: { url: "https://checkout.stripe.com/session/free" },
      ok: true,
    });
    expect(upgradeSubscriptionMock).toHaveBeenCalledWith({
      body: {
        cancelUrl: "/subscriptions?status=cancel",
        customerType: "user",
        disableRedirect: true,
        plan: "free",
        returnUrl: "/subscriptions",
        successUrl: "/subscriptions?status=success",
      },
      headers: new Headers(),
    });
  });

  it("maps better-auth API errors for upgrade flow", async () => {
    upgradeSubscriptionMock.mockRejectedValue({
      body: {
        code: "SUBSCRIPTION_PLAN_NOT_FOUND",
        message: "Plan does not exist",
      },
      status: "error",
      statusCode: 400,
    });

    const { upgradePersonalSubscription } = await import("../action");

    const result = await upgradePersonalSubscription({
      authContext: {
        organizationId: null,
        userId: "user-1",
      },
      plan: "pro",
    });

    expect(result).toEqual({
      error: {
        code: "SUBSCRIPTION_PLAN_NOT_FOUND",
        message: "Plan does not exist",
      },
      ok: false,
    });
  });

  it("returns billing portal url from better-auth", async () => {
    createBillingPortalMock.mockResolvedValue({
      url: "https://billing.stripe.com/session/test",
    });

    const { openPersonalBillingPortal } = await import("../action");

    const result = await openPersonalBillingPortal({
      authContext: {
        organizationId: null,
        userId: "user-1",
      },
    });

    expect(result).toEqual({
      data: { url: "https://billing.stripe.com/session/test" },
      ok: true,
    });
    expect(createBillingPortalMock).toHaveBeenCalledWith({
      body: {
        customerType: "user",
        disableRedirect: true,
        returnUrl: "/subscriptions",
      },
      headers: new Headers(),
    });
  });
});
