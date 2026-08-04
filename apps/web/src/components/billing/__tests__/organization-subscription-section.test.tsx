import { render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
const pushMock = vi.fn();
const replaceMock = vi.fn();
const updateOrganizationSubscriptionSeatsMock = vi.fn();
const upgradeOrganizationSubscriptionMock = vi.fn();
const subscriptionPlanCardMock = vi.fn();
const subscriptionEnterprisePlanCardMock = vi.fn();
const subscriptionFreePlanRowMock = vi.fn();
const purchaseSuccessModalMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
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
  updateOrganizationSubscriptionSeats: (...args: unknown[]) =>
    updateOrganizationSubscriptionSeatsMock(...args),
  upgradeOrganizationSubscription: (...args: unknown[]) =>
    upgradeOrganizationSubscriptionMock(...args),
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

vi.mock("../subscription-enterprise-plan-card", () => ({
  SubscriptionEnterprisePlanCard: (props: unknown) => {
    subscriptionEnterprisePlanCardMock(props);
    return <div data-testid="subscription-enterprise-plan-card" />;
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

const coworkersPromise = Promise.resolve([]);

describe("OrganizationSubscriptionSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateOrganizationSubscriptionSeatsMock.mockResolvedValue({
      data: { seats: 3 },
      ok: true,
    });
    upgradeOrganizationSubscriptionMock.mockResolvedValue({
      data: { mode: "redirect", url: "https://checkout.stripe.com/test" },
      ok: true,
    });
  });

  it("shows only the enterprise card when the org has a consumable contract", () => {
    render(
      <OrganizationSubscriptionSection
        assignedSeatCount={2}
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPlan="enterprise"
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        currentSeats={5}
        isEnterpriseConsumable
        isEnterpriseContract
        memberCount={3}
        organizationId="org-enterprise"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status={null}
      />,
    );

    expect(subscriptionEnterprisePlanCardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isCurrent: true,
      }),
    );
    expect(subscriptionPlanCardMock).not.toHaveBeenCalled();
    expect(subscriptionFreePlanRowMock).not.toHaveBeenCalled();
  });

  it("shows self-serve plans after the enterprise commercial term ends", () => {
    render(
      <OrganizationSubscriptionSection
        assignedSeatCount={0}
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPlan="enterprise"
        currentPeriodEnd={null}
        currentSeats={5}
        isEnterpriseConsumable={false}
        isEnterpriseContract
        memberCount={0}
        organizationId="org-enterprise-post-term"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status={null}
      />,
    );

    expect(subscriptionEnterprisePlanCardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isCurrent: true,
      }),
    );
    expect(subscriptionPlanCardMock).toHaveBeenCalled();
    expect(subscriptionFreePlanRowMock).toHaveBeenCalled();
  });

  it("renders a cancel action for the current paid plan and no action for free", () => {
    render(
      <OrganizationSubscriptionSection
        assignedSeatCount={1}
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPlan="starter"
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
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
        creditsText: 'includedCreditsPerSeat:{"credits":250}',
        plan: expect.objectContaining({ name: "free" }),
      }),
    );
    expect(subscriptionEnterprisePlanCardMock).toHaveBeenCalledTimes(1);
  });

  it("shows the scheduled cancellation date on the current paid plan", () => {
    render(
      <OrganizationSubscriptionSection
        assignedSeatCount={2}
        cancelAtPeriodEnd
        coworkersPromise={coworkersPromise}
        currentPlan="starter"
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
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

  it("keeps seat updates as the primary action when seat count changes", () => {
    render(
      <OrganizationSubscriptionSection
        assignedSeatCount={3}
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPlan="starter"
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        currentSeats={2}
        memberCount={3}
        organizationId="org-1"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status={null}
      />,
    );

    expect(subscriptionPlanCardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionLabel: "updateSeatsCta",
        plan: expect.objectContaining({ name: "starter" }),
      }),
    );
  });

  it("uses the upgrade action for non-current paid plans", async () => {
    render(
      <OrganizationSubscriptionSection
        assignedSeatCount={1}
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPlan="starter"
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
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
      expect(upgradeOrganizationSubscriptionMock).toHaveBeenCalledWith({
        organizationId: "org-1",
        plan: "standard",
        returnPath: "/billing?tab=subscription",
        seats: 2,
      });
    });
  });

  it("shows success toast and refreshes when upgrade completes without checkout redirect", async () => {
    upgradeOrganizationSubscriptionMock.mockResolvedValue({
      data: { mode: "complete" },
      ok: true,
    });

    render(
      <OrganizationSubscriptionSection
        assignedSeatCount={1}
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPlan="starter"
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        currentPeriodEnd={new Date("2026-04-01T00:00:00.000Z")}
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
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

  it("does not open the purchase success modal when status is null", () => {
    render(
      <OrganizationSubscriptionSection
        assignedSeatCount={1}
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPlan="starter"
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        currentPeriodEnd={null}
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
        status={null}
      />,
    );

    expect(purchaseSuccessModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ open: false }),
    );
  });

  it("opens the purchase success modal with the current plan name when status is success", () => {
    render(
      <OrganizationSubscriptionSection
        assignedSeatCount={1}
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPlan="starter"
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        currentPeriodEnd={null}
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
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
      <OrganizationSubscriptionSection
        assignedSeatCount={1}
        cancelAtPeriodEnd={false}
        coworkersPromise={coworkersPromise}
        currentPlan="starter"
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        currentPeriodEnd={null}
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
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
