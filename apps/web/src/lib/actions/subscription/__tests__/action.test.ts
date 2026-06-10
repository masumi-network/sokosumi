import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const headersMock = vi.fn(async () => new Headers());
const cookieDeleteMock = vi.fn();
const cookiesMock = vi.fn(async () => ({
  delete: cookieDeleteMock,
}));
const upgradeSubscriptionMock = vi.fn();
const createBillingPortalMock = vi.fn();
const updateOrganizationSeatsImmediatelyMock = vi.fn();
const assertPersonalSubscriptionChangeAllowedMock = vi.fn();
const assertOrganizationSubscriptionChangeAllowedMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
  headers: headersMock,
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      createBillingPortal: createBillingPortalMock,
      upgradeSubscription: upgradeSubscriptionMock,
    },
  },
}));

vi.mock("@/lib/services", () => ({
  billingService: {
    assertOrganizationSubscriptionChangeAllowed: (...args: unknown[]) =>
      assertOrganizationSubscriptionChangeAllowedMock(...args),
    assertPersonalSubscriptionChangeAllowed: (...args: unknown[]) =>
      assertPersonalSubscriptionChangeAllowedMock(...args),
  },
  organizationSubscriptionService: {
    updateOrganizationSeatsImmediately: updateOrganizationSeatsImmediatelyMock,
  },
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

const session = {
  user: {
    id: "user-1",
  },
  session: {
    activeOrganizationId: null,
  },
} as never;

const organizationSession = {
  user: {
    id: "user-1",
  },
  session: {
    activeOrganizationId: "org-1",
  },
} as never;

describe("subscription actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertPersonalSubscriptionChangeAllowedMock.mockResolvedValue(undefined);
    assertOrganizationSubscriptionChangeAllowedMock.mockResolvedValue(
      undefined,
    );
  });

  it("returns BAD_INPUT for invalid plan names", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { upgradePersonalSubscription } = await import("../action");

    const result = await upgradePersonalSubscription({
      session,
      plan: "invalid-plan" as never,
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
      session,
      plan: "starter",
    });

    expect(result).toEqual({
      data: {
        mode: "redirect",
        url: "https://checkout.stripe.com/session/test",
      },
      ok: true,
    });
    expect(upgradeSubscriptionMock).toHaveBeenCalledWith({
      body: {
        cancelUrl: "/billing?tab=subscription&status=cancel",
        customerType: "user",
        disableRedirect: true,
        plan: "starter",
        returnUrl: "/billing?tab=subscription",
        successUrl: "/billing?tab=subscription&status=success",
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
      session,
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
      session,
    });

    expect(result).toEqual({
      data: { url: "https://billing.stripe.com/session/test" },
      ok: true,
    });
    expect(createBillingPortalMock).toHaveBeenCalledWith({
      body: {
        customerType: "user",
        disableRedirect: true,
        returnUrl: "/billing?tab=subscription",
      },
      headers: new Headers(),
    });
  });

  it("uses returnPath for personal subscription redirect urls", async () => {
    upgradeSubscriptionMock.mockResolvedValue({
      url: "https://checkout.stripe.com/session/test",
    });

    const { upgradePersonalSubscription } = await import("../action");

    const result = await upgradePersonalSubscription({
      session,
      plan: "starter",
      returnPath: "/billing?tab=subscription",
    });

    expect(result).toEqual({
      data: {
        mode: "redirect",
        url: "https://checkout.stripe.com/session/test",
      },
      ok: true,
    });
    expect(upgradeSubscriptionMock).toHaveBeenCalledWith({
      body: {
        cancelUrl: "/billing?tab=subscription&status=cancel",
        customerType: "user",
        disableRedirect: true,
        plan: "starter",
        returnUrl: "/billing?tab=subscription",
        successUrl: "/billing?tab=subscription&status=success",
      },
      headers: new Headers(),
    });
  });

  it("uses returnPath for personal billing portal", async () => {
    createBillingPortalMock.mockResolvedValue({
      url: "https://billing.stripe.com/session/test",
    });

    const { openPersonalBillingPortal } = await import("../action");

    const result = await openPersonalBillingPortal({
      session,
      returnPath: "/billing?tab=coupon",
    });

    expect(result).toEqual({
      data: { url: "https://billing.stripe.com/session/test" },
      ok: true,
    });
    expect(createBillingPortalMock).toHaveBeenCalledWith({
      body: {
        customerType: "user",
        disableRedirect: true,
        returnUrl: "/billing?tab=coupon",
      },
      headers: new Headers(),
    });
  });

  it("returns BAD_INPUT for invalid organization seats", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { upgradeOrganizationSubscription } = await import("../action");

    const result = await upgradeOrganizationSubscription({
      session: organizationSession,
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
      session: organizationSession,
      organizationId: "org-1",
      plan: "pro",
      returnPath: "/organizations/acme",
      seats: 7,
    });

    expect(result).toEqual({
      data: {
        mode: "redirect",
        url: "https://checkout.stripe.com/session/org-test",
      },
      ok: true,
    });

    expect(upgradeSubscriptionMock).toHaveBeenCalledWith({
      body: {
        cancelUrl: "/organizations/acme?status=cancel",
        customerType: "organization",
        disableRedirect: true,
        plan: "pro",
        referenceId: "org-1",
        returnUrl: "/organizations/acme",
        seats: 7,
        successUrl: "/organizations/acme?status=success",
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
      session: organizationSession,
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
      session: organizationSession,
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
      session: organizationSession,
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
      Object.assign(
        new Error(
          "Only organization owners and admins can manage subscriptions",
        ),
        { status: "FORBIDDEN" },
      ),
    );

    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { updateOrganizationSubscriptionSeats } = await import("../action");

    const result = await updateOrganizationSubscriptionSeats({
      session: organizationSession,
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

  it("maps bad request immediate seat update errors", async () => {
    updateOrganizationSeatsImmediatelyMock.mockRejectedValue(
      Object.assign(
        new Error(
          "An active organization subscription is required before updating seats.",
        ),
        { status: "BAD_REQUEST" },
      ),
    );

    const { CommonErrorCode } = await import("@/lib/actions/errors");
    const { updateOrganizationSubscriptionSeats } = await import("../action");

    const result = await updateOrganizationSubscriptionSeats({
      session: organizationSession,
      organizationId: "org-1",
      seats: 5,
    });

    expect(result).toEqual({
      error: {
        code: CommonErrorCode.BAD_INPUT,
        message:
          "An active organization subscription is required before updating seats.",
      },
      ok: false,
    });
  });
});
