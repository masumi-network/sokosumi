import { render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
const replaceMock = vi.fn();
const upgradePersonalSubscriptionMock = vi.fn();
const subscriptionPlanCardMock = vi.fn();
const subscriptionFreePlanRowMock = vi.fn();
const purchaseSuccessModalMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    replace: replaceMock,
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

vi.mock("@/components/billing/purchase-success-modal", () => ({
  PurchaseSuccessModal: (props: unknown) => {
    purchaseSuccessModalMock(props);
    return null;
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

const coworkersPromise = Promise.resolve([]);

describe("PersonalSubscriptionSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upgradePersonalSubscriptionMock.mockResolvedValue({
      data: { mode: "redirect", url: "https://checkout.stripe.com/test" },
      ok: true,
    });
  });

  it("renders a cancel action for the current paid plan and no action for free", () => {
    render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
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
        coworkersPromise={coworkersPromise}
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
        coworkersPromise={coworkersPromise}
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
  });

  it("shows success toast and refreshes when upgrade completes without checkout redirect", async () => {
    upgradePersonalSubscriptionMock.mockResolvedValue({
      data: { mode: "complete" },
      ok: true,
    });

    render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
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
  });

  it("does not show a status banner when status is null", () => {
    render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPeriodEnd={null}
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status={null}
      />,
    );

    expect(purchaseSuccessModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ open: false }),
    );
  });

  it("shows a cancel banner (not the success modal) when status is cancel", () => {
    const { getByText } = render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPeriodEnd={null}
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status="cancel"
      />,
    );

    expect(getByText("statusCancel")).toBeInTheDocument();
    expect(purchaseSuccessModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ open: false }),
    );
  });

  it("opens the purchase success modal with the current plan name when status is success", () => {
    render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPeriodEnd={null}
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status="success"
      />,
    );

    expect(purchaseSuccessModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        headline: 'subscriptionTitle:{"plan":"Plans.starter.name"}',
        coworkersPromise,
      }),
    );
  });

  it("closing the success modal strips the status param via router.replace", () => {
    render(
      <PersonalSubscriptionSection
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPeriodEnd={null}
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status="success"
      />,
    );

    const { onOpenChange } = purchaseSuccessModalMock.mock.calls.at(-1)?.[0];
    onOpenChange(false);

    expect(replaceMock).toHaveBeenCalledWith("/billing?tab=subscription");
  });
});
