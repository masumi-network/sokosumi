import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Organization } from "@/lib/clients/generated/core";
import { MemberRole } from "@/lib/clients/generated/core";

const getMyMemberInOrganizationMock = vi.fn();
const getOrganizationBillingPlanForOnboardingMock = vi.fn();
const getSeatSummaryMock = vi.fn();
const resolvePersonalActiveSubscriptionPlanForOnboardingMock = vi.fn();
const getSubscriptionCatalogMock = vi.fn();
const onboardingDialogMock = vi.fn();
const userHasPaidOrEnterpriseCoverageMock = vi.fn();
const markSubscriptionOnboardingGateSeenMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getSubscriptionCatalog: (...args: unknown[]) =>
      getSubscriptionCatalogMock(...args),
  },
}));

vi.mock("@/lib/services", () => ({
  getOrganizationBillingPlanForOnboarding: (...args: unknown[]) =>
    getOrganizationBillingPlanForOnboardingMock(...args),
  organizationSeatService: {
    getSeatSummary: (...args: unknown[]) => getSeatSummaryMock(...args),
  },
  resolvePersonalActiveSubscriptionPlanForOnboarding: (...args: unknown[]) =>
    resolvePersonalActiveSubscriptionPlanForOnboardingMock(...args),
  userHasPaidOrEnterpriseCoverage: (...args: unknown[]) =>
    userHasPaidOrEnterpriseCoverageMock(...args),
  userService: {
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
  },
}));

vi.mock("@/lib/actions/onboarding", () => ({
  markSubscriptionOnboardingGateSessionSeen: (...args: unknown[]) =>
    markSubscriptionOnboardingGateSeenMock(...args),
}));

vi.mock("../subscription-onboarding-dialog", () => ({
  SubscriptionOnboardingDialog: (props: unknown) => {
    onboardingDialogMock(props);
    return <div data-testid="subscription-onboarding-dialog" />;
  },
}));

vi.mock("../mark-subscription-onboarding-gate-seen", () => ({
  MarkSubscriptionOnboardingGateSeen: ({ loginId }: { loginId: string }) => (
    <div data-testid="mark-gate-seen" data-login-id={loginId} />
  ),
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

describe("SubscriptionOnboardingDialogLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userHasPaidOrEnterpriseCoverageMock.mockResolvedValue(false);
    markSubscriptionOnboardingGateSeenMock.mockResolvedValue(undefined);
    getSubscriptionCatalogMock.mockResolvedValue({
      data: createSubscriptionCatalog(),
    });
    getOrganizationBillingPlanForOnboardingMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      isConsumable: false,
      mode: "self_serve",
      periodEnd: null,
      plan: "starter",
      purchasedSeats: 3,
    });
    resolvePersonalActiveSubscriptionPlanForOnboardingMock.mockResolvedValue({
      plan: "pro",
      status: "ok",
    });
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

  it("skips subscription-only onboarding when the user has paid or enterprise coverage", async () => {
    userHasPaidOrEnterpriseCoverageMock.mockResolvedValue(true);

    const { SubscriptionOnboardingDialogLoader } = await import(
      "../subscription-onboarding-dialog-loader"
    );

    const { getByTestId, queryByTestId } = render(
      (await SubscriptionOnboardingDialogLoader({
        activeOrganization: createActiveOrganization(),
        loginId: "session-1",
      })) as ReactNode,
    );

    expect(getByTestId("return-handler")).toBeTruthy();
    expect(getByTestId("mark-gate-seen")).toHaveAttribute(
      "data-login-id",
      "session-1",
    );
    expect(queryByTestId("subscription-onboarding-dialog")).toBeNull();
    expect(onboardingDialogMock).not.toHaveBeenCalled();
    expect(userHasPaidOrEnterpriseCoverageMock).toHaveBeenCalledOnce();
    expect(getMyMemberInOrganizationMock).not.toHaveBeenCalled();
    expect(getSubscriptionCatalogMock).not.toHaveBeenCalled();
    expect(getOrganizationBillingPlanForOnboardingMock).not.toHaveBeenCalled();
    expect(
      resolvePersonalActiveSubscriptionPlanForOnboardingMock,
    ).not.toHaveBeenCalled();
  });

  it("short-circuits subscription-only org gates for non-admin members without billing fetches", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.MEMBER,
    });

    const { SubscriptionOnboardingDialogLoader } = await import(
      "../subscription-onboarding-dialog-loader"
    );

    const { getByTestId, queryByTestId } = render(
      (await SubscriptionOnboardingDialogLoader({
        activeOrganization: createActiveOrganization(),
        loginId: "session-1",
      })) as ReactNode,
    );

    expect(getByTestId("return-handler")).toBeTruthy();
    expect(queryByTestId("subscription-onboarding-dialog")).toBeNull();
    expect(onboardingDialogMock).not.toHaveBeenCalled();
    expect(userHasPaidOrEnterpriseCoverageMock).toHaveBeenCalledOnce();
    expect(getMyMemberInOrganizationMock).toHaveBeenCalledOnce();
    expect(getSubscriptionCatalogMock).not.toHaveBeenCalled();
    expect(getOrganizationBillingPlanForOnboardingMock).not.toHaveBeenCalled();
    expect(
      resolvePersonalActiveSubscriptionPlanForOnboardingMock,
    ).not.toHaveBeenCalled();
  });

  it("skips the onboarding dialog when the subscription catalog cannot be loaded", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    getSubscriptionCatalogMock.mockRejectedValue(new Error("Stripe outage"));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { SubscriptionOnboardingDialogLoader } = await import(
      "../subscription-onboarding-dialog-loader"
    );

    const { getByTestId, queryByTestId } = render(
      (await SubscriptionOnboardingDialogLoader({
        activeOrganization: createActiveOrganization(),
        loginId: "session-1",
      })) as ReactNode,
    );

    expect(getByTestId("return-handler")).toBeTruthy();
    expect(queryByTestId("subscription-onboarding-dialog")).toBeNull();
    expect(onboardingDialogMock).not.toHaveBeenCalled();
    expect(userHasPaidOrEnterpriseCoverageMock).toHaveBeenCalledOnce();
    expect(getMyMemberInOrganizationMock).toHaveBeenCalledOnce();
    expect(getOrganizationBillingPlanForOnboardingMock).not.toHaveBeenCalled();
    expect(
      resolvePersonalActiveSubscriptionPlanForOnboardingMock,
    ).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to load subscription catalog for onboarding",
      expect.any(Error),
    );
  });

  it("skips subscription-only onboarding when the active organization plan is already paid", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    getOrganizationBillingPlanForOnboardingMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      isConsumable: false,
      mode: "self_serve",
      periodEnd: null,
      plan: "standard",
      purchasedSeats: 5,
    });

    const { SubscriptionOnboardingDialogLoader } = await import(
      "../subscription-onboarding-dialog-loader"
    );

    const { getByTestId, queryByTestId } = render(
      (await SubscriptionOnboardingDialogLoader({
        activeOrganization: createActiveOrganization(),
        loginId: "session-1",
      })) as ReactNode,
    );

    expect(getByTestId("return-handler")).toBeTruthy();
    expect(getByTestId("mark-gate-seen")).toBeTruthy();
    expect(queryByTestId("subscription-onboarding-dialog")).toBeNull();
    expect(onboardingDialogMock).not.toHaveBeenCalled();
    expect(getSubscriptionCatalogMock).toHaveBeenCalledOnce();
    expect(getOrganizationBillingPlanForOnboardingMock).toHaveBeenCalledOnce();
    expect(getOrganizationBillingPlanForOnboardingMock).toHaveBeenCalledWith(
      "org-1",
    );
  });

  it("shows no current personal plan when the user has no active subscriptions", async () => {
    resolvePersonalActiveSubscriptionPlanForOnboardingMock.mockResolvedValue({
      plan: "free",
      status: "ok",
    });

    const { SubscriptionOnboardingDialogLoader } = await import(
      "../subscription-onboarding-dialog-loader"
    );

    const { getByTestId } = render(
      (await SubscriptionOnboardingDialogLoader({
        activeOrganization: null,
        loginId: "session-1",
      })) as ReactNode,
    );

    expect(getByTestId("subscription-onboarding-dialog")).toBeTruthy();
    const props = onboardingDialogMock.mock.calls[0]?.[0] as {
      paidPlans: Array<{ isCurrent: boolean; name: string }>;
    };
    expect(props.paidPlans.every((plan) => !plan.isCurrent)).toBe(true);
    expect(
      resolvePersonalActiveSubscriptionPlanForOnboardingMock,
    ).toHaveBeenCalledOnce();
  });

  it("skips subscription-only onboarding when personal subscription reads fail", async () => {
    resolvePersonalActiveSubscriptionPlanForOnboardingMock.mockResolvedValue({
      status: "unavailable",
    });

    const { SubscriptionOnboardingDialogLoader } = await import(
      "../subscription-onboarding-dialog-loader"
    );

    const { getByTestId, queryByTestId } = render(
      (await SubscriptionOnboardingDialogLoader({
        activeOrganization: null,
        loginId: "session-1",
      })) as ReactNode,
    );

    expect(getByTestId("return-handler")).toBeTruthy();
    expect(queryByTestId("subscription-onboarding-dialog")).toBeNull();
    expect(onboardingDialogMock).not.toHaveBeenCalled();
  });
});
