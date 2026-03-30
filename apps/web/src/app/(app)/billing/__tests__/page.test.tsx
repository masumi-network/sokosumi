import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MemberRole } from "@sokosumi/database";
import { render } from "@testing-library/react";

const listActiveSubscriptionsMock = vi.fn();
const getSessionMock = vi.fn();
const getActiveOrganizationMock = vi.fn();
const getMyMemberInOrganizationMock = vi.fn();
const getBalanceMock = vi.fn();
const getSubscriptionCatalogMock = vi.fn();
const zeroMarginTopUpEnabledMock = vi.fn();
const creditsSectionMock = vi.fn();
const billingTabsMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
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

vi.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      listActiveSubscriptions: (...args: unknown[]) =>
        listActiveSubscriptionsMock(...args),
    },
  },
}));

vi.mock("@/lib/auth/utils", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {},
}));

vi.mock("@/lib/flags/zero-margin-top-up", () => ({
  zeroMarginTopUpEnabled: (...args: unknown[]) =>
    zeroMarginTopUpEnabledMock(...args),
}));

vi.mock("@/lib/services", () => ({
  userService: {
    getActiveOrganization: (...args: unknown[]) =>
      getActiveOrganizationMock(...args),
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
  },
}));

vi.mock("@/lib/stripe/subscription-catalog", () => ({
  getSubscriptionCatalog: (...args: unknown[]) =>
    getSubscriptionCatalogMock(...args),
}));

vi.mock("@/lib/utils/credits", () => ({
  formatCreditsForDisplay: (credits: number) => String(credits),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    getBalance: (...args: unknown[]) => getBalanceMock(...args),
  },
}));

vi.mock("@/components/billing/balance-section", () => ({
  BalanceSection: () => <div data-testid="balance-section" />,
}));

vi.mock("@/components/billing/billing-portal-card", () => ({
  BillingPortalCard: () => <div data-testid="billing-portal-card" />,
}));

vi.mock("@/components/billing/billing-tabs", () => ({
  BillingTabs: (props: {
    couponContent: React.ReactNode;
    creditsContent?: React.ReactNode;
    showCreditsTab: boolean;
    subscriptionContent: React.ReactNode;
  }) => {
    billingTabsMock(props);
    return (
      <div data-testid="billing-tabs">
        {props.subscriptionContent}
        {props.creditsContent}
        {props.couponContent}
      </div>
    );
  },
}));

vi.mock("@/components/billing/coupon-section", () => ({
  __esModule: true,
  default: () => <div data-testid="coupon-section" />,
}));

vi.mock("@/components/billing/credits-section", () => ({
  __esModule: true,
  default: (props: unknown) => {
    creditsSectionMock(props);
    return <div data-testid="credits-section" />;
  },
}));

vi.mock("@/components/billing/organization-subscription-section", () => ({
  OrganizationSubscriptionSection: () => (
    <div data-testid="organization-subscription-section" />
  ),
}));

vi.mock("@/components/billing/personal-subscription-section", () => ({
  PersonalSubscriptionSection: () => (
    <div data-testid="personal-subscription-section" />
  ),
}));

function createSubscriptionCatalog() {
  return {
    free: { credits: 250, currency: "EUR", monthlyAmount: 0 },
    pro: { credits: 14_000, currency: "EUR", monthlyAmount: 20_000 },
    standard: { credits: 5_250, currency: "EUR", monthlyAmount: 7_500 },
    starter: { credits: 1_750, currency: "EUR", monthlyAmount: 2_500 },
  };
}

describe("BillingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({
      user: {
        email: "member@nmkr.io",
        id: "user-1",
      },
    });
    getBalanceMock.mockResolvedValue(BigInt(0));
    getSubscriptionCatalogMock.mockResolvedValue(createSubscriptionCatalog());
    listActiveSubscriptionsMock.mockResolvedValue([
      {
        periodEnd: "2026-03-01T00:00:00.000Z",
        plan: "pro",
        seats: 2,
      },
    ]);
  });

  it("passes the zero-margin override to personal billing credits when the flag is enabled", async () => {
    getActiveOrganizationMock.mockResolvedValue(null);
    zeroMarginTopUpEnabledMock.mockResolvedValue(true);
    listActiveSubscriptionsMock.mockResolvedValue([
      {
        periodEnd: "2026-03-01T00:00:00.000Z",
        plan: "free",
        seats: 1,
      },
    ]);

    const { default: BillingPage } = await import("../page");

    render(
      await BillingPage({
        searchParams: Promise.resolve({
          tab: "credits",
        }),
      }),
    );

    expect(creditsSectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isPurchaseEnabled: true,
        organization: null,
        priceLookupKeyOverride: "credit_0_margin",
        returnPath: "/billing?tab=credits",
      }),
    );
  });

  it("passes the zero-margin override to organization billing credits when the flag is enabled", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      _count: { members: 2 },
      id: "org-1",
      name: "Org One",
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    zeroMarginTopUpEnabledMock.mockResolvedValue(true);
    listActiveSubscriptionsMock.mockResolvedValue([
      {
        periodEnd: "2026-03-01T00:00:00.000Z",
        plan: "free",
        seats: 2,
      },
    ]);

    const { default: BillingPage } = await import("../page");

    render(
      await BillingPage({
        searchParams: Promise.resolve({
          tab: "credits",
        }),
      }),
    );

    expect(creditsSectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isPurchaseEnabled: true,
        organization: expect.objectContaining({
          id: "org-1",
        }),
        priceLookupKeyOverride: "credit_0_margin",
        returnPath: "/billing?tab=credits",
      }),
    );
  });

  it("keeps tiered billing pricing when the flag is disabled", async () => {
    getActiveOrganizationMock.mockResolvedValue(null);
    zeroMarginTopUpEnabledMock.mockResolvedValue(false);

    const { default: BillingPage } = await import("../page");

    render(
      await BillingPage({
        searchParams: Promise.resolve({
          tab: "credits",
        }),
      }),
    );

    expect(creditsSectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organization: null,
        priceLookupKeyOverride: undefined,
        returnPath: "/billing?tab=credits",
      }),
    );
  });

  it("shows the personal credits tab even on the free plan", async () => {
    getActiveOrganizationMock.mockResolvedValue(null);
    zeroMarginTopUpEnabledMock.mockResolvedValue(false);
    listActiveSubscriptionsMock.mockResolvedValue([
      {
        periodEnd: "2026-03-01T00:00:00.000Z",
        plan: "free",
        seats: 1,
      },
    ]);

    const { default: BillingPage } = await import("../page");

    render(
      await BillingPage({
        searchParams: Promise.resolve({
          tab: "credits",
        }),
      }),
    );

    expect(billingTabsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        showCreditsTab: true,
      }),
    );
    expect(creditsSectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isPurchaseEnabled: false,
        organization: null,
        returnPath: "/billing?tab=credits",
      }),
    );
  });
});
