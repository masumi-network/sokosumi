import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MemberRole } from "@sokosumi/database";
import { render } from "@testing-library/react";

const getSessionMock = vi.fn();
const getActiveOrganizationMock = vi.fn();
const getMyMemberInOrganizationMock = vi.fn();
const getBalanceMock = vi.fn();
const getLatestActiveSubscriptionByReferenceIdMock = vi.fn();
const getSubscriptionCatalogMock = vi.fn();
const getUserByIdMock = vi.fn();
const zeroMarginTopUpEnabledMock = vi.fn();
const balanceBillingPortalLinkMock = vi.fn();
const creditsSectionMock = vi.fn();
const billingTabsMock = vi.fn();
const organizationSubscriptionSectionMock = vi.fn();
const personalSubscriptionSectionMock = vi.fn();

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
  subscriptionRepository: {
    getLatestActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      getLatestActiveSubscriptionByReferenceIdMock(...args),
  },
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

vi.mock("@/components/billing/balance-section", () => ({
  BalanceSection: (props: { billingPortal?: React.ReactNode }) => (
    <div data-testid="balance-section">{props.billingPortal}</div>
  ),
}));

vi.mock("@/components/billing/balance-billing-portal-link", () => ({
  BalanceBillingPortalLink: (props: unknown) => {
    balanceBillingPortalLinkMock(props);
    return <div data-testid="balance-billing-portal-link" />;
  },
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
  OrganizationSubscriptionSection: (props: unknown) => {
    organizationSubscriptionSectionMock(props);
    return <div data-testid="organization-subscription-section" />;
  },
}));

vi.mock("@/components/billing/personal-subscription-section", () => ({
  PersonalSubscriptionSection: (props: unknown) => {
    personalSubscriptionSectionMock(props);
    return <div data-testid="personal-subscription-section" />;
  },
}));

function createSubscriptionCatalog() {
  return {
    enterpriseProducts: [],
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
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      periodEnd: "2026-03-01T00:00:00.000Z",
      plan: "pro",
      seats: 2,
    });
    getSubscriptionCatalogMock.mockResolvedValue(createSubscriptionCatalog());
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      stripeCustomerId: "cus_user_1",
    });
  });

  it("passes the zero-margin override to personal billing credits when the flag is enabled", async () => {
    getActiveOrganizationMock.mockResolvedValue(null);
    zeroMarginTopUpEnabledMock.mockResolvedValue(true);
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      periodEnd: "2026-03-01T00:00:00.000Z",
      plan: "free",
      seats: 1,
    });

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
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      periodEnd: "2026-03-01T00:00:00.000Z",
      plan: "free",
      seats: 2,
    });

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
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      periodEnd: "2026-03-01T00:00:00.000Z",
      plan: "free",
      seats: 1,
    });

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
    expect(personalSubscriptionSectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelAtPeriodEnd: false,
        currentPeriodEnd: "2026-03-01T00:00:00.000Z",
        returnPath: "/billing?tab=subscription",
        status: null,
      }),
    );
  });

  it("uses the local subscription row for organization seats and hides the billing portal without a Stripe customer", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      _count: { members: 2 },
      id: "org-1",
      name: "Org One",
      stripeCustomerId: null,
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    zeroMarginTopUpEnabledMock.mockResolvedValue(false);
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      periodEnd: "2026-03-01T00:00:00.000Z",
      plan: "free",
      seats: 5,
    });

    const { default: BillingPage } = await import("../page");

    const view = render(
      await BillingPage({
        searchParams: Promise.resolve({
          tab: "subscription",
        }),
      }),
    );

    expect(organizationSubscriptionSectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelAtPeriodEnd: false,
        currentPlan: "free",
        currentPeriodEnd: "2026-03-01T00:00:00.000Z",
        currentSeats: 5,
        memberCount: 2,
      }),
    );
    expect(balanceBillingPortalLinkMock).not.toHaveBeenCalled();
    expect(view.queryByTestId("balance-billing-portal-link")).toBeNull();
  });

  it("hides the billing portal for organization enterprise plans even with a Stripe customer", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      _count: { members: 2 },
      id: "org-1",
      name: "Org One",
      stripeCustomerId: "cus_org_1",
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    zeroMarginTopUpEnabledMock.mockResolvedValue(false);
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      periodEnd: "2026-03-01T00:00:00.000Z",
      plan: "enterprise",
      seats: 10,
    });

    const { default: BillingPage } = await import("../page");

    const view = render(
      await BillingPage({
        searchParams: Promise.resolve({
          tab: "subscription",
        }),
      }),
    );

    expect(balanceBillingPortalLinkMock).not.toHaveBeenCalled();
    expect(view.queryByTestId("balance-billing-portal-link")).toBeNull();
  });
});
