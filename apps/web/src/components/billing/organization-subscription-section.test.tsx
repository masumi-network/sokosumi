import { render, waitFor } from "@testing-library/react";
import { type Action, toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
const pushMock = vi.fn();
const organizationSeatsCardMock = vi.fn();
const upgradeOrganizationSubscriptionMock = vi.fn();
const subscriptionPlanCardMock = vi.fn();
const subscriptionEnterprisePlanCardMock = vi.fn();
const subscriptionFreePlanRowMock = vi.fn();
const beginCheckoutMock = vi.fn();

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

vi.mock("@/lib/actions/subscription/action", () => ({
  upgradeOrganizationSubscription: (...args: unknown[]) =>
    upgradeOrganizationSubscriptionMock(...args),
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    beginCheckout: (...args: unknown[]) => beginCheckoutMock(...args),
  },
}));

vi.mock("./organization-seats-card", () => ({
  OrganizationSeatsCard: (props: unknown) => {
    organizationSeatsCardMock(props);
    return <div data-testid="organization-seats-card" />;
  },
}));

vi.mock("./subscription-plan-card", () => ({
  SubscriptionPlanCard: (props: unknown) => {
    subscriptionPlanCardMock(props);
    return <div data-testid="subscription-plan-card" />;
  },
}));

vi.mock("./subscription-free-plan-row", () => ({
  SubscriptionFreePlanRow: (props: unknown) => {
    subscriptionFreePlanRowMock(props);
    return <div data-testid="subscription-free-plan-row" />;
  },
}));

vi.mock("./subscription-enterprise-plan-card", () => ({
  SubscriptionEnterprisePlanCard: (props: unknown) => {
    subscriptionEnterprisePlanCardMock(props);
    return <div data-testid="subscription-enterprise-plan-card" />;
  },
}));

import { OrganizationSubscriptionSection } from "./organization-subscription-section";

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
    upgradeOrganizationSubscriptionMock.mockResolvedValue({
      value: { mode: "redirect", url: "https://checkout.stripe.com/test" },
      ok: true,
    });
  });

  it("shows only the enterprise card when the org has a consumable contract", () => {
    render(
      <OrganizationSubscriptionSection
        assignedCount={1}
        scheduledCancelDate={null}
        scheduledSeats={null}
        scheduledSeatsAt={null}
        currentSeats={5}
        isEnterpriseConsumable
        isEnterpriseContract
        memberCount={3}
        organizationId="org-enterprise"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
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
        assignedCount={1}
        scheduledCancelDate={null}
        scheduledSeats={null}
        scheduledSeatsAt={null}
        currentSeats={5}
        isEnterpriseConsumable={false}
        isEnterpriseContract
        memberCount={0}
        organizationId="org-enterprise-post-term"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
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

  it.each([
    { cards: 4, columns: "2xl:grid-cols-4", isEnterpriseContract: false },
    { cards: 3, columns: "2xl:grid-cols-3", isEnterpriseContract: true },
  ])(
    "fits $cards plan cards on one wide row with $columns",
    ({ cards, columns, isEnterpriseContract }) => {
      const { getAllByTestId } = render(
        <OrganizationSubscriptionSection
          assignedCount={1}
          isEnterpriseConsumable={false}
          isEnterpriseContract={isEnterpriseContract}
          scheduledCancelDate={null}
          scheduledSeats={null}
          scheduledSeatsAt={null}
          currentSeats={2}
          memberCount={2}
          organizationId="org-1"
          plans={[
            ...createPlans(),
            {
              credits: 15000,
              currency: "eur",
              isCurrent: false,
              monthlyAmount: 20000,
              name: "pro" as const,
            },
          ]}
          returnPath="/billing?tab=subscription"
        />,
      );

      const grid = getAllByTestId("subscription-plan-card")[0].parentElement;
      expect(grid).toHaveClass(columns);
      expect(grid?.children).toHaveLength(cards);
    },
  );

  it("renders a cancel action for the current paid plan and no action for free", () => {
    render(
      <OrganizationSubscriptionSection
        assignedCount={1}
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        scheduledCancelDate={null}
        scheduledSeats={null}
        scheduledSeatsAt={null}
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
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
    expect(
      subscriptionFreePlanRowMock.mock.calls.at(-1)?.[0],
    ).not.toHaveProperty("creditsText");
    expect(subscriptionEnterprisePlanCardMock).toHaveBeenCalledTimes(1);
  });

  it("shows the scheduled cancellation date on the current paid plan", () => {
    render(
      <OrganizationSubscriptionSection
        assignedCount={1}
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        scheduledCancelDate={new Date("2026-04-01T00:00:00.000Z")}
        scheduledSeats={null}
        scheduledSeatsAt={null}
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

  it("does not force purchased seats up to the assigned member count", () => {
    render(
      <OrganizationSubscriptionSection
        assignedCount={1}
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        scheduledCancelDate={null}
        scheduledSeats={null}
        scheduledSeatsAt={null}
        currentSeats={2}
        memberCount={3}
        organizationId="org-1"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
      />,
    );

    expect(subscriptionPlanCardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionLabel: "currentPlanCta",
        isDisabled: true,
        plan: expect.objectContaining({ name: "starter" }),
      }),
    );
  });

  it("gives a current paid plan the seats card instead of the checkout seat field", () => {
    const { queryByRole } = render(
      <OrganizationSubscriptionSection
        assignedCount={1}
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        scheduledCancelDate={null}
        scheduledSeats={null}
        scheduledSeatsAt={null}
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
      />,
    );

    expect(organizationSeatsCardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedCount: 1,
        currentSeats: 2,
        organizationId: "org-1",
        scheduledCancelDate: null,
        scheduledSeats: null,
        scheduledSeatsAt: null,
      }),
    );
    expect(queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("keeps the checkout seat field when no paid plan is current", () => {
    const { getByRole } = render(
      <OrganizationSubscriptionSection
        assignedCount={0}
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        scheduledCancelDate={null}
        scheduledSeats={null}
        scheduledSeatsAt={null}
        currentSeats={1}
        memberCount={2}
        organizationId="org-1"
        plans={createPlans().map((plan) => ({
          ...plan,
          isCurrent: plan.name === "free",
        }))}
        returnPath="/billing?tab=subscription"
      />,
    );

    expect(organizationSeatsCardMock).not.toHaveBeenCalled();
    expect(getByRole("spinbutton")).toHaveValue(1);
  });

  it("hides the seats card during a consumable enterprise contract", () => {
    render(
      <OrganizationSubscriptionSection
        assignedCount={3}
        scheduledCancelDate={null}
        scheduledSeats={null}
        scheduledSeatsAt={null}
        currentSeats={5}
        isEnterpriseConsumable
        isEnterpriseContract
        memberCount={3}
        organizationId="org-enterprise"
        plans={createPlans().map((plan) => ({ ...plan, isCurrent: false }))}
        returnPath="/billing?tab=subscription"
      />,
    );

    expect(organizationSeatsCardMock).not.toHaveBeenCalled();
  });

  it("offers the Stripe portal when a seat change fails on payment", () => {
    const assignSpy = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign: assignSpy });

    render(
      <OrganizationSubscriptionSection
        assignedCount={1}
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        scheduledCancelDate={null}
        scheduledSeats={null}
        scheduledSeatsAt={null}
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
      />,
    );

    organizationSeatsCardMock.mock.calls[0][0].onError({
      code: "BAD_INPUT",
      kind: "subscription_payment_failed",
      message: "Core wording",
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Errors.paymentFailed",
      expect.objectContaining({
        action: expect.objectContaining({
          label: "Errors.paymentFailedAction",
        }),
      }),
    );

    const [, options] = vi.mocked(toast.error).mock.calls[0];
    const action = options?.action as Action;
    action.onClick({} as never);

    expect(assignSpy).toHaveBeenCalledWith(
      `/api/billing/portal?${new URLSearchParams({
        returnPath: "/billing?tab=subscription",
        organizationId: "org-1",
      })}`,
    );
    vi.unstubAllGlobals();
  });

  it("uses the upgrade action for non-current paid plans", async () => {
    render(
      <OrganizationSubscriptionSection
        assignedCount={1}
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        scheduledCancelDate={null}
        scheduledSeats={null}
        scheduledSeatsAt={null}
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
    expect(beginCheckoutMock).toHaveBeenCalledWith({
      plan: "standard",
      seats: 2,
    });
  });

  it("shows success toast and refreshes when upgrade completes without checkout redirect", async () => {
    upgradeOrganizationSubscriptionMock.mockResolvedValue({
      value: { mode: "complete" },
      ok: true,
    });

    render(
      <OrganizationSubscriptionSection
        assignedCount={1}
        isEnterpriseConsumable={false}
        isEnterpriseContract={false}
        scheduledCancelDate={null}
        scheduledSeats={null}
        scheduledSeatsAt={null}
        currentSeats={2}
        memberCount={2}
        organizationId="org-1"
        plans={createPlans()}
        returnPath="/billing?tab=subscription"
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
});
