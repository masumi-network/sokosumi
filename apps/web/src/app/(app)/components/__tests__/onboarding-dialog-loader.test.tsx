import { MemberRole } from "@sokosumi/database";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Organization } from "@/lib/clients/generated/core";

const getMyMemberInOrganizationMock = vi.fn();
const getOrganizationBillingPlanMock = vi.fn();
const getSeatSummaryMock = vi.fn();
const listActiveSubscriptionsMock = vi.fn();
const getSubscriptionCatalogMock = vi.fn();
const onboardingDialogMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("stripe", () => ({
  __esModule: true,
  default: vi.fn(function MockStripe() {
    return {};
  }),
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    STRIPE_SECRET_KEY: "sk_test_mock",
  }),
}));

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  },
  coreClient: {
    getOrganizationBillingPlan: (...args: unknown[]) =>
      getOrganizationBillingPlanMock(...args),
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  listActiveSubscriptions: (...args: unknown[]) =>
    listActiveSubscriptionsMock(...args),
}));

vi.mock("@/lib/services", () => ({
  organizationSeatService: {
    getSeatSummary: (...args: unknown[]) => getSeatSummaryMock(...args),
  },
  userService: {
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
  },
}));

vi.mock("@/lib/stripe/subscription-catalog", () => ({
  getSubscriptionCatalog: (...args: unknown[]) =>
    getSubscriptionCatalogMock(...args),
}));

vi.mock("../onboarding-dialog", () => ({
  OnboardingDialog: (props: unknown) => {
    onboardingDialogMock(props);
    return <div data-testid="onboarding-dialog" />;
  },
}));

vi.mock("../onboarding-subscription-return-handler", () => ({
  OnboardingSubscriptionReturnHandler: () => (
    <div data-testid="return-handler" />
  ),
}));

function createActiveOrganization(): Organization {
  return {
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    id: "org-1",
    logo: null,
    metadata: null,
    name: "Org One",
    role: "member",
    slug: "org-one",
  };
}

function createSubscriptionCatalog() {
  return {
    free: { credits: 250, currency: "eur", monthlyAmount: 0 },
    pro: { credits: 14_000, currency: "eur", monthlyAmount: 20_000 },
    standard: { credits: 5_250, currency: "eur", monthlyAmount: 7_500 },
    starter: { credits: 1_750, currency: "eur", monthlyAmount: 2_500 },
  };
}

describe("OnboardingDialogLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSubscriptionCatalogMock.mockResolvedValue(createSubscriptionCatalog());
    getOrganizationBillingPlanMock.mockResolvedValue({
      data: {
        cancelAtPeriodEnd: false,
        isConsumable: false,
        mode: "self_serve",
        periodEnd: null,
        plan: "starter",
        purchasedSeats: 3,
      },
    });
    listActiveSubscriptionsMock.mockResolvedValue([
      {
        periodEnd: "2026-04-01T00:00:00.000Z",
        plan: "pro",
      },
    ]);
    getSeatSummaryMock.mockResolvedValue({
      assignedCount: 2,
      memberCount: 3,
      paidPlan: null,
      purchasedSeats: 3,
      unusedSeats: 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the personal current plan for restricted full onboarding", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.MEMBER,
    });

    const { OnboardingDialogLoader } = await import(
      "../onboarding-dialog-loader"
    );

    render(
      (await OnboardingDialogLoader({
        activeOrganization: createActiveOrganization(),
        loginId: "session-1",
        subscriptionOnly: false,
      })) as ReactNode,
    );

    const props = onboardingDialogMock.mock.calls[0]?.[0] as {
      organizationSubscription?: unknown;
      paidPlans: Array<{ isCurrent: boolean; name: string }>;
      subscriptionCheckoutMode: string;
      subscriptionOnly?: boolean;
    };

    expect(props.subscriptionCheckoutMode).toBe("restricted");
    expect(props.organizationSubscription).toBeUndefined();
    expect(props.subscriptionOnly).toBe(false);
    expect(props.paidPlans.find((plan) => plan.name === "pro")?.isCurrent).toBe(
      true,
    );
    expect(
      props.paidPlans.find((plan) => plan.name === "starter")?.isCurrent,
    ).toBe(false);
    expect(listActiveSubscriptionsMock).toHaveBeenCalledOnce();
    expect(listActiveSubscriptionsMock).toHaveBeenCalledWith({
      customerType: "user",
    });
  });

  it("short-circuits subscription-only org gates for non-admin members without billing fetches", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.MEMBER,
    });

    const { OnboardingDialogLoader } = await import(
      "../onboarding-dialog-loader"
    );

    const { getByTestId, queryByTestId } = render(
      (await OnboardingDialogLoader({
        activeOrganization: createActiveOrganization(),
        loginId: "session-1",
        subscriptionOnly: true,
      })) as ReactNode,
    );

    expect(getByTestId("return-handler")).toBeTruthy();
    expect(queryByTestId("onboarding-dialog")).toBeNull();
    expect(onboardingDialogMock).not.toHaveBeenCalled();
    expect(getMyMemberInOrganizationMock).toHaveBeenCalledOnce();
    expect(getSubscriptionCatalogMock).not.toHaveBeenCalled();
    expect(getOrganizationBillingPlanMock).not.toHaveBeenCalled();
    expect(listActiveSubscriptionsMock).not.toHaveBeenCalled();
  });

  it("skips the onboarding dialog when the subscription catalog cannot be loaded", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    getSubscriptionCatalogMock.mockRejectedValue(new Error("Stripe outage"));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { OnboardingDialogLoader } = await import(
      "../onboarding-dialog-loader"
    );

    const { getByTestId, queryByTestId } = render(
      (await OnboardingDialogLoader({
        activeOrganization: createActiveOrganization(),
        loginId: "session-1",
        subscriptionOnly: true,
      })) as ReactNode,
    );

    expect(getByTestId("return-handler")).toBeTruthy();
    expect(queryByTestId("onboarding-dialog")).toBeNull();
    expect(onboardingDialogMock).not.toHaveBeenCalled();
    expect(getMyMemberInOrganizationMock).toHaveBeenCalledOnce();
    expect(getOrganizationBillingPlanMock).not.toHaveBeenCalled();
    expect(listActiveSubscriptionsMock).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to load subscription catalog for onboarding",
      expect.any(Error),
    );
  });

  it("defaults personal plan to free when active subscriptions cannot be loaded", async () => {
    listActiveSubscriptionsMock.mockResolvedValue([]);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { OnboardingDialogLoader } = await import(
      "../onboarding-dialog-loader"
    );

    const { getByTestId } = render(
      (await OnboardingDialogLoader({
        activeOrganization: null,
        loginId: "session-1",
        subscriptionOnly: true,
      })) as ReactNode,
    );

    expect(getByTestId("onboarding-dialog")).toBeTruthy();
    const props = onboardingDialogMock.mock.calls[0]?.[0] as {
      paidPlans: Array<{ isCurrent: boolean; name: string }>;
    };
    expect(props.paidPlans.every((plan) => !plan.isCurrent)).toBe(true);
    expect(listActiveSubscriptionsMock).toHaveBeenCalledOnce();
    expect(listActiveSubscriptionsMock).toHaveBeenCalledWith({
      customerType: "user",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
