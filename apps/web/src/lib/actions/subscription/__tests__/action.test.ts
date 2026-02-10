jest.mock("server-only", () => ({}));

const headersMock = jest.fn(async () => new Headers());
const upgradeSubscriptionMock = jest.fn();
const createBillingPortalMock = jest.fn();
const updateOrganizationSeatsImmediatelyMock = jest.fn();

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

jest.mock("@/lib/services", () => ({
  organizationSubscriptionService: {
    updateOrganizationSeatsImmediately: (...args: unknown[]) =>
      updateOrganizationSeatsImmediatelyMock(...args),
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

  it("returns BAD_INPUT for invalid organization seats", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { upgradeOrganizationSubscription } = await import("../action");

    const result = await upgradeOrganizationSubscription({
      authContext: {
        organizationId: "org-1",
        userId: "user-1",
      },
      organizationId: "org-1",
      plan: "starter",
      returnPath: "/organizations/org-1",
      seats: 0,
    });

    expect(result).toEqual({
      error: {
        code: CommonErrorCode.BAD_INPUT,
      },
      ok: false,
    });
    expect(upgradeSubscriptionMock).not.toHaveBeenCalled();
  });

  it("returns checkout url for organization subscription upgrade", async () => {
    upgradeSubscriptionMock.mockResolvedValue({
      url: "https://checkout.stripe.com/session/org-test",
    });

    const { upgradeOrganizationSubscription } = await import("../action");

    const result = await upgradeOrganizationSubscription({
      authContext: {
        organizationId: "org-1",
        userId: "user-1",
      },
      organizationId: "org-1",
      plan: "pro",
      returnPath: "/organizations/acme",
      seats: 7,
    });

    expect(result).toEqual({
      data: { url: "https://checkout.stripe.com/session/org-test" },
      ok: true,
    });

    expect(upgradeSubscriptionMock).toHaveBeenCalledWith({
      body: {
        cancelUrl: "/organizations/acme",
        customerType: "organization",
        disableRedirect: true,
        plan: "pro",
        referenceId: "org-1",
        returnUrl: "/organizations/acme",
        seats: 7,
        successUrl: "/organizations/acme",
      },
      headers: new Headers(),
    });
  });

  it("returns billing portal url for organization", async () => {
    createBillingPortalMock.mockResolvedValue({
      url: "https://billing.stripe.com/session/org-test",
    });

    const { openOrganizationBillingPortal } = await import("../action");

    const result = await openOrganizationBillingPortal({
      authContext: {
        organizationId: "org-1",
        userId: "user-1",
      },
      organizationId: "org-1",
      returnPath: "/organizations/acme",
    });

    expect(result).toEqual({
      data: { url: "https://billing.stripe.com/session/org-test" },
      ok: true,
    });
    expect(createBillingPortalMock).toHaveBeenCalledWith({
      body: {
        customerType: "organization",
        disableRedirect: true,
        referenceId: "org-1",
        returnUrl: "/organizations/acme",
      },
      headers: new Headers(),
    });
  });

  it("returns BAD_INPUT for invalid immediate organization seat update", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { updateOrganizationSubscriptionSeats } = await import("../action");

    const result = await updateOrganizationSubscriptionSeats({
      authContext: {
        organizationId: "org-1",
        userId: "user-1",
      },
      organizationId: "org-1",
      seats: 0,
    });

    expect(result).toEqual({
      error: {
        code: CommonErrorCode.BAD_INPUT,
      },
      ok: false,
    });
    expect(updateOrganizationSeatsImmediatelyMock).not.toHaveBeenCalled();
  });

  it("updates organization seats immediately without redirect flow", async () => {
    updateOrganizationSeatsImmediatelyMock.mockResolvedValue({
      seats: 9,
    });

    const { updateOrganizationSubscriptionSeats } = await import("../action");

    const result = await updateOrganizationSubscriptionSeats({
      authContext: {
        organizationId: "org-1",
        userId: "user-1",
      },
      organizationId: "org-1",
      seats: 9,
    });

    expect(result).toEqual({
      data: { seats: 9 },
      ok: true,
    });
    expect(updateOrganizationSeatsImmediatelyMock).toHaveBeenCalledWith(
      "user-1",
      "org-1",
      9,
    );
    expect(upgradeSubscriptionMock).not.toHaveBeenCalled();
  });

  it("maps unauthorized immediate seat update errors", async () => {
    updateOrganizationSeatsImmediatelyMock.mockRejectedValue(
      new Error("Only organization owners and admins can manage subscriptions"),
    );

    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { updateOrganizationSubscriptionSeats } = await import("../action");

    const result = await updateOrganizationSubscriptionSeats({
      authContext: {
        organizationId: "org-1",
        userId: "user-1",
      },
      organizationId: "org-1",
      seats: 5,
    });

    expect(result).toEqual({
      error: {
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Only organization owners and admins can manage subscriptions",
      },
      ok: false,
    });
  });
});
