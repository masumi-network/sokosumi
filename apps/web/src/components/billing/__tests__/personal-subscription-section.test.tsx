import { render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
const upgradePersonalSubscriptionMock = vi.fn();
const subscriptionPlanCardMock = vi.fn();
const subscriptionFreePlanRowMock = vi.fn();
const beginCheckoutMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
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
  upgradePersonalSubscription: (...args: unknown[]) =>
    upgradePersonalSubscriptionMock(...args),
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    beginCheckout: (...args: unknown[]) => beginCheckoutMock(...args),
  },
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

import { PersonalSubscriptionSection } from "../personal-subscription-section";

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

describe("PersonalSubscriptionSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upgradePersonalSubscriptionMock.mockResolvedValue({
      value: { mode: "redirect", url: "https://checkout.stripe.com/test" },
      ok: true,
    });
  });

  it("renders a cancel action for the current paid plan and no action for free", () => {
    render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd={false}
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status={null}
      />,
    );

    expect(subscriptionPlanCardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionLabel: "currentPlanCta",
        isDisabled: true,
        plan: expect.objectContaining({ name: "starter" }),
      }),
    );
    expect(subscriptionFreePlanRowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({ name: "free" }),
      }),
    );
  });

  it("shows the scheduled cancellation date on the current paid plan", () => {
    render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status={null}
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

  it("uses the upgrade action for non-current paid plans", async () => {
    render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd={false}
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status={null}
      />,
    );

    const currentPlanProps = subscriptionPlanCardMock.mock.calls
      .map((call) => call[0])
      .find(
        (props) =>
          props &&
          typeof props === "object" &&
          "plan" in props &&
          props.plan?.name === "standard",
      );

    await currentPlanProps?.onAction("standard");

    await waitFor(() => {
      expect(upgradePersonalSubscriptionMock).toHaveBeenCalledWith({
        plan: "standard",
        returnPath: "/billing?tab=subscription",
      });
    });
    expect(beginCheckoutMock).toHaveBeenCalledWith({ plan: "standard" });
  });

  it("shows success toast and refreshes when upgrade completes without checkout redirect", async () => {
    upgradePersonalSubscriptionMock.mockResolvedValue({
      value: { mode: "complete" },
      ok: true,
    });

    render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd={false}
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status={null}
      />,
    );

    const standardPlanProps = subscriptionPlanCardMock.mock.calls
      .map((call) => call[0])
      .find(
        (props) =>
          props &&
          typeof props === "object" &&
          "plan" in props &&
          props.plan?.name === "standard",
      );

    await standardPlanProps?.onAction("standard");

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("statusSuccess");
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(beginCheckoutMock).not.toHaveBeenCalled();
  });

  it("does not show a status banner when status is null", () => {
    const { queryByText } = render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd={false}
        currentPeriodEnd={null}
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status={null}
      />,
    );

    expect(queryByText("statusCancel")).not.toBeInTheDocument();
  });

  it("shows a cancel banner when status is cancel", () => {
    const { getByText } = render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd={false}
        currentPeriodEnd={null}
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status="cancel"
      />,
    );

    expect(getByText("statusCancel")).toBeInTheDocument();
  });

  it("does not show a status banner when status is success (the success modal, owned by the billing page, handles that)", () => {
    const { queryByText } = render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd={false}
        currentPeriodEnd={null}
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status="success"
      />,
    );

    expect(queryByText("statusCancel")).not.toBeInTheDocument();
  });
});
