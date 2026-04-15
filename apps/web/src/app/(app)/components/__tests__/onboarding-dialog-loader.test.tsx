import { MemberRole } from "@sokosumi/database";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMyMemberInOrganizationMock = vi.fn();
const getLatestActiveSubscriptionByReferenceIdMock = vi.fn();
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

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {},
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      listActiveSubscriptions: (...args: unknown[]) =>
        listActiveSubscriptionsMock(...args),
    },
  },
}));

vi.mock("@/lib/services", () => ({
  userService: {
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
  },
}));

vi.mock("@/lib/stripe/subscription-catalog", () => ({
  getSubscriptionCatalog: (...args: unknown[]) =>
    getSubscriptionCatalogMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  subscriptionRepository: {
    getLatestActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      getLatestActiveSubscriptionByReferenceIdMock(...args),
  },
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
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      plan: "starter",
      seats: 3,
    });
    listActiveSubscriptionsMock.mockResolvedValue([
      {
        periodEnd: "2026-04-01T00:00:00.000Z",
        plan: "pro",
      },
    ]);
  });

  it("keeps org-scoped subscription gates restricted for non-admin members", async () => {
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.MEMBER,
    });

    const { OnboardingDialogLoader } = await import(
      "../onboarding-dialog-loader"
    );

    render(
      (await OnboardingDialogLoader({
        activeOrganization: {
          _count: { members: 3 },
          id: "org-1",
          name: "Org One",
        } as never,
        loginId: "session-1",
        subscriptionOnly: true,
      })) as ReactNode,
    );

    const props = onboardingDialogMock.mock.calls[0]?.[0] as {
      loginId?: string;
      organizationSubscription?: unknown;
      paidPlans: Array<{ isCurrent: boolean; name: string }>;
      subscriptionCheckoutMode: string;
      subscriptionOnly?: boolean;
    };

    expect(props.subscriptionCheckoutMode).toBe("restricted");
    expect(props.organizationSubscription).toBeUndefined();
    expect(props.loginId).toBe("session-1");
    expect(props.subscriptionOnly).toBe(true);
    expect(
      props.paidPlans.find((plan) => plan.name === "starter")?.isCurrent,
    ).toBe(true);
    expect(listActiveSubscriptionsMock).not.toHaveBeenCalled();
  });
});
