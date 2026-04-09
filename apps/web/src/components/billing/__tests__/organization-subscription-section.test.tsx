import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
const pushMock = vi.fn();
const cancelOrganizationSubscriptionMock = vi.fn();
const updateOrganizationSubscriptionSeatsMock = vi.fn();
const upgradeOrganizationSubscriptionMock = vi.fn();
const subscriptionPlanCardMock = vi.fn();
const subscriptionFreePlanRowMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: () => "Apr 1, 2026",
  }),
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/actions/subscription", () => ({
  cancelOrganizationSubscription: (...args: unknown[]) =>
    cancelOrganizationSubscriptionMock(...args),
  updateOrganizationSubscriptionSeats: (...args: unknown[]) =>
    updateOrganizationSubscriptionSeatsMock(...args),
  upgradeOrganizationSubscription: (...args: unknown[]) =>
    upgradeOrganizationSubscriptionMock(...args),
}));

vi.mock("../subscription-plan-card", () => ({
  SubscriptionPlanCard: (props: unknown) => {
    subscriptionPlanCardMock(props);
    return <div data-testid="subscription-plan-card" />;
  },
}));

vi.mock("../subscription-free-plan-row", () => ({
  SubscriptionFreePlanRow: (props: unknown) => {
    subscriptionFreePlanRowMock(props);
    return <div data-testid="subscription-free-plan-row" />;
  },
}));

import { OrganizationSubscriptionSection } from "../organization-subscription-section";

function createPlans() {
  return [
    {
      credits: 250,
      currency: "eur",
      isCurrent: false,
      monthlyAmount: 0,
      name: "free" as const,
    },
    {
      credits: 1750,
      currency: "eur",
      isCurrent: true,
      monthlyAmount: 2500,
      name: "starter" as const,
    },
    {
      credits: 5250,
      currency: "eur",
      isCurrent: false,
      monthlyAmount: 7500,
      name: "standard" as const,
    },
  ];
}

describe("OrganizationSubscriptionSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelOrganizationSubscriptionMock.mockResolvedValue({
      data: { mode: "scheduled" },
      ok: true,
    });
    updateOrganizationSubscriptionSeatsMock.mockResolvedValue({
      data: { seats: 3 },
      ok: true,
    });
    upgradeOrganizationSubscriptionMock.mockResolvedValue({
      data: { mode: "redirect", url: "https://checkout.stripe.com/test" },
      ok: true,
    });
  });

  it("renders a cancel action for the current paid plan and no action for free", () => {
    render(
      <OrganizationSubscriptionSection
        cancelAtPeriodEnd={false}
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        currentPlan="starter"
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
      />,
    );

    expect(subscriptionPlanCardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionLabel: "cancelSubscriptionCta",
        isDisabled: false,
        plan: expect.objectContaining({ name: "starter" }),
      }),
    );
    expect(subscriptionFreePlanRowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionLabel: null,
        plan: expect.objectContaining({ name: "free" }),
      }),
    );
  });

  it("shows the scheduled cancellation state on the current paid plan", () => {
    render(
      <OrganizationSubscriptionSection
        cancelAtPeriodEnd
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        currentPlan="starter"
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
      />,
    );

    expect(subscriptionPlanCardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionLabel: 'cancelsOnDate:{"date":"Apr 1, 2026"}',
        isDisabled: true,
        plan: expect.objectContaining({ name: "starter" }),
      }),
    );
  });

  it("keeps seat updates as the primary action when seat count changes", () => {
    render(
      <OrganizationSubscriptionSection
        cancelAtPeriodEnd={false}
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        currentPlan="starter"
        currentSeats={2}
        memberCount={3}
        organizationId="org-1"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
      />,
    );

    expect(subscriptionPlanCardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionLabel: "updateSeatsCta",
        plan: expect.objectContaining({ name: "starter" }),
      }),
    );
  });

  it("uses the cancel action for the current paid plan", async () => {
    render(
      <OrganizationSubscriptionSection
        cancelAtPeriodEnd={false}
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        currentPlan="starter"
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
      />,
    );

    const currentPlanProps = subscriptionPlanCardMock.mock.calls
      .map((call) => call[0])
      .find(
        (props) =>
          props &&
          typeof props === "object" &&
          "plan" in props &&
          props.plan?.name === "starter",
      );

    await currentPlanProps?.onAction("starter");

    await waitFor(() => {
      expect(cancelOrganizationSubscriptionMock).toHaveBeenCalledWith({
        organizationId: "org-1",
      });
    });
    expect(upgradeOrganizationSubscriptionMock).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
