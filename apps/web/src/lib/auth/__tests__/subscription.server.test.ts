import { beforeEach, describe, expect, it, vi } from "vitest";

const subscriptionUpgradeMock = vi.fn();
const subscriptionBillingPortalMock = vi.fn();
const clearSubscriptionOnboardingGateSessionCookieMock = vi.fn();
const headersMock = vi.fn();
const resolveWebRequestOriginMock = vi.fn(
  () => "https://preprod.sokosumi.com" as string | undefined,
);

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));

vi.mock("@/lib/actions/onboarding", () => ({
  clearSubscriptionOnboardingGateSessionCookie:
    clearSubscriptionOnboardingGateSessionCookieMock,
}));

vi.mock("@/lib/auth/auth.server.client", () => ({
  getAuthServerClient: () => ({
    subscription: {
      billingPortal: (...args: unknown[]) =>
        subscriptionBillingPortalMock(...args),
      upgrade: (...args: unknown[]) => subscriptionUpgradeMock(...args),
    },
  }),
  resolveWebRequestOrigin: () => resolveWebRequestOriginMock(),
}));

describe("subscription.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveWebRequestOriginMock.mockReturnValue("https://preprod.sokosumi.com");
    headersMock.mockResolvedValue(
      new Headers({ origin: "https://preprod.sokosumi.com" }),
    );
  });

  it("returns checkout url from Core auth subscription.upgrade for personal plans", async () => {
    subscriptionUpgradeMock.mockResolvedValue({
      data: { url: "https://checkout.stripe.com/session/test" },
      error: null,
    });

    const { upgradePersonalSubscriptionServer } = await import(
      "../subscription.server"
    );

    const result = await upgradePersonalSubscriptionServer({
      plan: "starter",
    });

    expect(result).toEqual({
      value: {
        mode: "redirect",
        url: "https://checkout.stripe.com/session/test",
      },
      ok: true,
    });
    expect(subscriptionUpgradeMock).toHaveBeenCalledWith({
      cancelUrl:
        "https://preprod.sokosumi.com/billing?tab=subscription&status=cancel",
      customerType: "user",
      disableRedirect: true,
      plan: "starter",
      returnUrl: "https://preprod.sokosumi.com/billing?tab=subscription",
      successUrl:
        "https://preprod.sokosumi.com/billing?tab=subscription&status=success",
    });
    expect(
      clearSubscriptionOnboardingGateSessionCookieMock,
    ).toHaveBeenCalledTimes(1);
  });

  it("maps auth client upgrade errors by status without leaking the raw message", async () => {
    subscriptionUpgradeMock.mockResolvedValue({
      data: null,
      error: {
        status: 400,
        code: "SUBSCRIPTION_PLAN_NOT_FOUND",
        message: "Plan does not exist",
      },
    });

    const { upgradePersonalSubscriptionServer } = await import(
      "../subscription.server"
    );

    const result = await upgradePersonalSubscriptionServer({
      plan: "pro",
    });

    expect(result).toEqual({
      error: {
        code: "BAD_INPUT",
      },
      ok: false,
    });
    expect(
      clearSubscriptionOnboardingGateSessionCookieMock,
    ).not.toHaveBeenCalled();
  });

  it("maps a 401 auth client error to UNAUTHENTICATED so the login affordance fires", async () => {
    subscriptionUpgradeMock.mockResolvedValue({
      data: null,
      error: {
        status: 401,
        code: "UNAUTHORIZED",
        message: "Session expired",
      },
    });

    const { upgradePersonalSubscriptionServer } = await import(
      "../subscription.server"
    );

    const result = await upgradePersonalSubscriptionServer({
      plan: "pro",
    });

    expect(result).toEqual({
      error: {
        code: "UNAUTHENTICATED",
      },
      ok: false,
    });
  });

  it("passes the enterprise-contract exclusivity code through for the UI to localize", async () => {
    subscriptionUpgradeMock.mockResolvedValue({
      data: null,
      error: {
        status: 400,
        code: "ORGANIZATION_ENTERPRISE_CONTRACT_EXCLUSIVE",
        message: "internal exclusivity detail",
      },
    });

    const { upgradeOrganizationSubscriptionServer } = await import(
      "../subscription.server"
    );

    const result = await upgradeOrganizationSubscriptionServer({
      organizationId: "org-1",
      plan: "pro",
      returnPath: "/organizations/acme",
      seats: 7,
    });

    expect(result).toEqual({
      error: {
        code: "ORGANIZATION_ENTERPRISE_CONTRACT_EXCLUSIVE",
      },
      ok: false,
    });
    expect(
      clearSubscriptionOnboardingGateSessionCookieMock,
    ).not.toHaveBeenCalled();
  });

  it("returns billing portal url from Core auth subscription.billingPortal", async () => {
    subscriptionBillingPortalMock.mockResolvedValue({
      data: { url: "https://billing.stripe.com/session/test" },
      error: null,
    });

    const { openPersonalBillingPortalServer } = await import(
      "../subscription.server"
    );

    const result = await openPersonalBillingPortalServer({
      returnPath: "/billing?tab=coupon",
    });

    expect(result).toEqual({
      value: { url: "https://billing.stripe.com/session/test" },
      ok: true,
    });
    expect(subscriptionBillingPortalMock).toHaveBeenCalledWith({
      customerType: "user",
      disableRedirect: true,
      returnUrl: "https://preprod.sokosumi.com/billing?tab=coupon",
    });
    expect(
      clearSubscriptionOnboardingGateSessionCookieMock,
    ).not.toHaveBeenCalled();
  });

  it("returns checkout url for organization subscription upgrade", async () => {
    subscriptionUpgradeMock.mockResolvedValue({
      data: { url: "https://checkout.stripe.com/session/org-test" },
      error: null,
    });

    const { upgradeOrganizationSubscriptionServer } = await import(
      "../subscription.server"
    );

    const result = await upgradeOrganizationSubscriptionServer({
      organizationId: "org-1",
      plan: "pro",
      returnPath: "/organizations/acme",
      seats: 7,
    });

    expect(result).toEqual({
      value: {
        mode: "redirect",
        url: "https://checkout.stripe.com/session/org-test",
      },
      ok: true,
    });
    expect(subscriptionUpgradeMock).toHaveBeenCalledWith({
      cancelUrl:
        "https://preprod.sokosumi.com/organizations/acme?status=cancel",
      customerType: "organization",
      disableRedirect: true,
      plan: "pro",
      referenceId: "org-1",
      returnUrl: "https://preprod.sokosumi.com/organizations/acme",
      seats: 7,
      successUrl:
        "https://preprod.sokosumi.com/organizations/acme?status=success",
    });
    expect(
      clearSubscriptionOnboardingGateSessionCookieMock,
    ).toHaveBeenCalledTimes(1);
  });

  it("returns billing portal url for organization", async () => {
    subscriptionBillingPortalMock.mockResolvedValue({
      data: { url: "https://billing.stripe.com/session/org-test" },
      error: null,
    });

    const { openOrganizationBillingPortalServer } = await import(
      "../subscription.server"
    );

    const result = await openOrganizationBillingPortalServer({
      organizationId: "org-1",
      returnPath: "/organizations/acme",
    });

    expect(result).toEqual({
      value: { url: "https://billing.stripe.com/session/org-test" },
      ok: true,
    });
    expect(subscriptionBillingPortalMock).toHaveBeenCalledWith({
      customerType: "organization",
      disableRedirect: true,
      referenceId: "org-1",
      returnUrl: "https://preprod.sokosumi.com/organizations/acme",
    });
  });

  it("fails an upgrade with INTERNAL_SERVER_ERROR when the request origin is unavailable", async () => {
    resolveWebRequestOriginMock.mockReturnValue(undefined);

    const { upgradePersonalSubscriptionServer } = await import(
      "../subscription.server"
    );

    const result = await upgradePersonalSubscriptionServer({
      plan: "starter",
    });

    expect(result).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
      },
      ok: false,
    });
    expect(subscriptionUpgradeMock).not.toHaveBeenCalled();
    expect(
      clearSubscriptionOnboardingGateSessionCookieMock,
    ).not.toHaveBeenCalled();
  });

  it("fails a billing-portal open with INTERNAL_SERVER_ERROR when the request origin is unavailable", async () => {
    resolveWebRequestOriginMock.mockReturnValue(undefined);

    const { openPersonalBillingPortalServer } = await import(
      "../subscription.server"
    );

    const result = await openPersonalBillingPortalServer({
      returnPath: "/billing?tab=coupon",
    });

    expect(result).toEqual({
      error: {
        code: "INTERNAL_SERVER_ERROR",
      },
      ok: false,
    });
    expect(subscriptionBillingPortalMock).not.toHaveBeenCalled();
  });
});
