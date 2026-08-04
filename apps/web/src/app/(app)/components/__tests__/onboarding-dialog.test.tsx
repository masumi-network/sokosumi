import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImgHTMLAttributes, ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const trackMock = vi.fn();
const completeOnboardingMock = vi.fn();
const markSubscriptionOnboardingGateSessionSeenMock = vi.fn();
const upgradeOrganizationSubscriptionMock = vi.fn();
const upgradePersonalSubscriptionMock = vi.fn();

vi.mock("@vercel/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

vi.mock("next/image", () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/contexts/coworkers-context", () => ({
  useCoworkersContext: () => ({
    coworkers: [],
  }),
}));

vi.mock("@/lib/actions", () => ({
  CommonErrorCode: {
    BAD_INPUT: "BAD_INPUT",
    INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
    UNAUTHENTICATED: "UNAUTHENTICATED",
    UNAUTHORIZED: "UNAUTHORIZED",
  },
}));

vi.mock("@/components/onboarding/onboarding-plan-radio-grid", () => ({
  OnboardingPlanRadioGrid: () => <div data-testid="plan-grid" />,
}));

vi.mock("@/components/masumi-logos", () => ({
  SokosumiIcon: () => <div data-testid="sokosumi-icon" />,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/actions/onboarding", () => ({
  completeOnboarding: (...args: unknown[]) => completeOnboardingMock(...args),
  markSubscriptionOnboardingGateSessionSeen: (...args: unknown[]) =>
    markSubscriptionOnboardingGateSessionSeenMock(...args),
}));

vi.mock("@/lib/actions/subscription", () => ({
  upgradeOrganizationSubscription: (...args: unknown[]) =>
    upgradeOrganizationSubscriptionMock(...args),
  upgradePersonalSubscription: (...args: unknown[]) =>
    upgradePersonalSubscriptionMock(...args),
}));

import { OnboardingDialog } from "../onboarding-dialog";

const SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY =
  "sokosumi.onboarding.subscription.lastLoginId";

function createPaidPlans() {
  return [
    {
      credits: 1000,
      currency: "eur",
      isCurrent: true,
      monthlyAmount: 1000,
      name: "starter" as const,
    },
    {
      credits: 2000,
      currency: "eur",
      isCurrent: false,
      monthlyAmount: 2000,
      name: "standard" as const,
    },
  ];
}

describe("OnboardingDialog organization subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markSubscriptionOnboardingGateSessionSeenMock.mockResolvedValue(undefined);
    window.localStorage.clear();
    completeOnboardingMock.mockResolvedValue({
      data: { redirectUrl: "/tasks" },
      ok: true,
    });
    upgradeOrganizationSubscriptionMock.mockResolvedValue({
      data: { mode: "complete" },
      ok: true,
    });
    upgradePersonalSubscriptionMock.mockResolvedValue({
      data: { mode: "complete" },
      ok: true,
    });
  });

  it("renders organization seat settings above the plan grid", () => {
    render(
      <OnboardingDialog
        organizationSubscription={{
          assignedSeatCount: 3,
          currentSeats: 5,
          memberCount: 3,
          organizationId: "org-1",
        }}
        paidPlans={createPaidPlans()}
        subscriptionCheckoutMode="organization"
        subscriptionOnly
      />,
    );

    expect(screen.getByLabelText("seatsInputLabel")).toHaveValue(5);
    expect(
      screen.getAllByText('seatsInputHint:{"members":3,"minimum":3}'),
    ).toHaveLength(2);
    expect(screen.getByTestId("plan-grid")).toBeInTheDocument();
  });

  it("submits organization checkout with the selected seat count", async () => {
    render(
      <OnboardingDialog
        organizationSubscription={{
          assignedSeatCount: 3,
          currentSeats: 5,
          memberCount: 3,
          organizationId: "org-1",
        }}
        paidPlans={createPaidPlans()}
        subscriptionCheckoutMode="organization"
        subscriptionOnly
      />,
    );

    fireEvent.change(screen.getByLabelText("seatsInputLabel"), {
      target: { value: "6" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "navigation.subscribe" }),
    );

    await waitFor(() => {
      expect(upgradeOrganizationSubscriptionMock).toHaveBeenCalledWith({
        organizationId: "org-1",
        plan: "standard",
        returnPath: "/tasks?onboarding_subscription=1",
        seats: 6,
      });
    });
  });

  it("blocks seat counts below the minimum assigned seat count", async () => {
    render(
      <OnboardingDialog
        organizationSubscription={{
          assignedSeatCount: 4,
          currentSeats: 4,
          memberCount: 4,
          organizationId: "org-1",
        }}
        paidPlans={createPaidPlans()}
        subscriptionCheckoutMode="organization"
        subscriptionOnly
      />,
    );

    fireEvent.change(screen.getByLabelText("seatsInputLabel"), {
      target: { value: "2" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "navigation.subscribe" }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Errors.badInput");
    });
    expect(upgradeOrganizationSubscriptionMock).not.toHaveBeenCalled();
  });

  it("opens once for a new subscription-only login and stores the login id", async () => {
    render(
      <OnboardingDialog
        loginId="session-1"
        paidPlans={createPaidPlans()}
        subscriptionCheckoutMode="personal"
        subscriptionOnly
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "navigation.subscribe" }),
      ).toBeInTheDocument();
    });
    expect(
      window.localStorage.getItem(SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY),
    ).toBe("session-1");
    expect(
      markSubscriptionOnboardingGateSessionSeenMock,
    ).not.toHaveBeenCalled();
  });

  it("keeps the subscription-only dialog closed for the same login id", async () => {
    window.localStorage.setItem(
      SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY,
      "session-1",
    );

    render(
      <OnboardingDialog
        loginId="session-1"
        paidPlans={createPaidPlans()}
        subscriptionCheckoutMode="personal"
        subscriptionOnly
      />,
    );

    expect(
      screen.queryByRole("button", { name: "navigation.subscribe" }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        markSubscriptionOnboardingGateSessionSeenMock,
      ).toHaveBeenCalledWith("session-1");
    });
  });

  it("keeps restricted organization gates closed without marking the session seen", async () => {
    render(
      <OnboardingDialog
        loginId="session-1"
        paidPlans={createPaidPlans()}
        subscriptionCheckoutMode="restricted"
        subscriptionOnly
      />,
    );

    expect(screen.queryByTestId("plan-grid")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(
        markSubscriptionOnboardingGateSessionSeenMock,
      ).not.toHaveBeenCalled();
    });
    expect(completeOnboardingMock).not.toHaveBeenCalled();
    expect(upgradePersonalSubscriptionMock).not.toHaveBeenCalled();
    expect(upgradeOrganizationSubscriptionMock).not.toHaveBeenCalled();
  });

  it("soft-dismisses subscription-only Skip without completing onboarding", async () => {
    render(
      <OnboardingDialog
        loginId="session-1"
        paidPlans={createPaidPlans()}
        subscriptionCheckoutMode="personal"
        subscriptionOnly
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "navigation.skip" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "navigation.skip" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "navigation.subscribe" }),
      ).not.toBeInTheDocument();
    });
    expect(trackMock).toHaveBeenCalledWith("Onboarding skipped");
    expect(markSubscriptionOnboardingGateSessionSeenMock).toHaveBeenCalledWith(
      "session-1",
    );
    expect(
      window.localStorage.getItem(SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY),
    ).toBe("session-1");
    expect(completeOnboardingMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("OnboardingDialog full intro Skip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markSubscriptionOnboardingGateSessionSeenMock.mockResolvedValue(undefined);
    window.localStorage.clear();
    completeOnboardingMock.mockResolvedValue({
      data: { redirectUrl: "/tasks" },
      ok: true,
    });
  });

  it("still completes onboarding when Skip is used on full intro", async () => {
    render(
      <OnboardingDialog
        paidPlans={createPaidPlans()}
        subscriptionCheckoutMode="personal"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "navigation.skip" }));

    await waitFor(() => {
      expect(completeOnboardingMock).toHaveBeenCalled();
    });
    expect(trackMock).toHaveBeenCalledWith("Onboarding skipped");
    expect(pushMock).toHaveBeenCalledWith("/tasks");
    expect(
      markSubscriptionOnboardingGateSessionSeenMock,
    ).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and toasts when completeOnboarding fails", async () => {
    completeOnboardingMock.mockResolvedValue({
      error: { message: "boom" },
      ok: false,
    });

    render(
      <OnboardingDialog
        paidPlans={createPaidPlans()}
        subscriptionCheckoutMode="personal"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "navigation.skip" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("boom");
    });
    expect(
      screen.getByRole("button", { name: "navigation.skip" }),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
