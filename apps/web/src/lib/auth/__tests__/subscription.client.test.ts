import { beforeEach, describe, expect, it, vi } from "vitest";

const validatePersonalSubscriptionChangeMock = vi.fn();
const validateOrganizationSubscriptionChangeMock = vi.fn();
const subscriptionUpgradeMock = vi.fn();
const subscriptionBillingPortalMock = vi.fn();
const clearSubscriptionOnboardingGateSessionCookieMock = vi.fn();

vi.mock("@/lib/actions/subscription", () => ({
  validateOrganizationSubscriptionChange:
    validateOrganizationSubscriptionChangeMock,
  validatePersonalSubscriptionChange: validatePersonalSubscriptionChangeMock,
}));

vi.mock("@/lib/actions/onboarding", () => ({
  clearSubscriptionOnboardingGateSessionCookie:
    clearSubscriptionOnboardingGateSessionCookieMock,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  subscription: {
    billingPortal: (...args: unknown[]) =>
      subscriptionBillingPortalMock(...args),
    upgrade: (...args: unknown[]) => subscriptionUpgradeMock(...args),
  },
}));

describe("subscription client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validatePersonalSubscriptionChangeMock.mockResolvedValue({
      data: undefined,
      ok: true,
    });
    validateOrganizationSubscriptionChangeMock.mockResolvedValue({
      data: undefined,
      ok: true,
    });
  });

  it("returns checkout url from authClient.subscription.upgrade for personal plans", async () => {
    subscriptionUpgradeMock.mockResolvedValue({
      data: { url: "https://checkout.stripe.com/session/test" },
      error: null,
    });

    const { upgradePersonalSubscriptionClient } = await import(
      "../subscription.client"
    );

    const result = await upgradePersonalSubscriptionClient({
      plan: "starter",
    });

    expect(result).toEqual({
      data: {
        mode: "redirect",
        url: "https://checkout.stripe.com/session/test",
      },
      ok: true,
    });
    expect(validatePersonalSubscriptionChangeMock).toHaveBeenCalledWith({
      plan: "starter",
      returnPath: undefined,
    });
    expect(subscriptionUpgradeMock).toHaveBeenCalledWith({
      cancelUrl: "/billing?tab=subscription&status=cancel",
      customerType: "user",
      disableRedirect: true,
      plan: "starter",
      returnUrl: "/billing?tab=subscription",
      successUrl: "/billing?tab=subscription&status=success",
    });
    expect(
      clearSubscriptionOnboardingGateSessionCookieMock,
    ).toHaveBeenCalledTimes(1);
  });

  it("maps authClient upgrade errors for personal checkout", async () => {
    subscriptionUpgradeMock.mockResolvedValue({
      data: null,
      error: {
        code: "SUBSCRIPTION_PLAN_NOT_FOUND",
        message: "Plan does not exist",
      },
    });

    const { upgradePersonalSubscriptionClient } = await import(
      "../subscription.client"
    );

    const result = await upgradePersonalSubscriptionClient({
      plan: "pro",
    });

    expect(result).toEqual({
      error: {
        code: "SUBSCRIPTION_PLAN_NOT_FOUND",
        message: "Plan does not exist",
      },
      ok: false,
    });
    // A failed checkout must not clear the onboarding gate, otherwise the gate
    // is permanently suppressed without the user completing checkout.
    expect(
      clearSubscriptionOnboardingGateSessionCookieMock,
    ).not.toHaveBeenCalled();
  });

  it("returns billing portal url from authClient.subscription.billingPortal", async () => {
    subscriptionBillingPortalMock.mockResolvedValue({
      data: { url: "https://billing.stripe.com/session/test" },
      error: null,
    });

    const { openPersonalBillingPortalClient } = await import(
      "../subscription.client"
    );

    const result = await openPersonalBillingPortalClient({
      returnPath: "/billing?tab=coupon",
    });

    expect(result).toEqual({
      data: { url: "https://billing.stripe.com/session/test" },
      ok: true,
    });
    expect(validatePersonalSubscriptionChangeMock).toHaveBeenCalledWith({
      returnPath: "/billing?tab=coupon",
    });
    expect(subscriptionBillingPortalMock).toHaveBeenCalledWith({
      customerType: "user",
      disableRedirect: true,
      returnUrl: "/billing?tab=coupon",
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

    const { upgradeOrganizationSubscriptionClient } = await import(
      "../subscription.client"
    );

    const result = await upgradeOrganizationSubscriptionClient({
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
    expect(validateOrganizationSubscriptionChangeMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      plan: "pro",
      returnPath: "/organizations/acme",
      seats: 7,
    });
    expect(subscriptionUpgradeMock).toHaveBeenCalledWith({
      cancelUrl: "/organizations/acme?status=cancel",
      customerType: "organization",
      disableRedirect: true,
      plan: "pro",
      referenceId: "org-1",
      returnUrl: "/organizations/acme",
      seats: 7,
      successUrl: "/organizations/acme?status=success",
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

    const { openOrganizationBillingPortalClient } = await import(
      "../subscription.client"
    );

    const result = await openOrganizationBillingPortalClient({
      organizationId: "org-1",
      returnPath: "/organizations/acme",
    });

    expect(result).toEqual({
      data: { url: "https://billing.stripe.com/session/org-test" },
      ok: true,
    });
    expect(validateOrganizationSubscriptionChangeMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      returnPath: "/organizations/acme",
    });
    expect(subscriptionBillingPortalMock).toHaveBeenCalledWith({
      customerType: "organization",
      disableRedirect: true,
      referenceId: "org-1",
      returnUrl: "/organizations/acme",
    });
  });
});
