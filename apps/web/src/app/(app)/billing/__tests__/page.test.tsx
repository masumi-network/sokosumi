import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MemberRole } from "@sokosumi/utils";
import { render } from "@testing-library/react";

const getSessionMock = vi.fn();
const getActiveOrganizationMock = vi.fn();
const getMyMemberInOrganizationMock = vi.fn();
const getMyCreditsMock = vi.fn();
const getMyOrganizationCreditsMock = vi.fn();
const getMyActiveSubscriptionMock = vi.fn();
const getSubscriptionCatalogMock = vi.fn();
const getMyStripeCustomerMock = vi.fn();
const getOrganizationStripeCustomerMock = vi.fn();
const getSeatSummaryMock = vi.fn();
const zeroMarginTopUpEnabledMock = vi.fn();
const balanceBillingPortalLinkMock = vi.fn();
const creditsSectionMock = vi.fn();
const billingTabsMock = vi.fn();
const organizationSubscriptionSectionMock = vi.fn();
const personalSubscriptionSectionMock = vi.fn();
const getOrganizationBillingPlanMock = vi.fn();
const getEnterpriseContractBillingSummaryMock = vi.fn();
const enterpriseContractSummaryMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

class MockCoreApiRequestError extends Error {
  status?: number;

  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "CoreApiRequestError";
    this.status = options?.status;
  }
}

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  coreClient: {
    getMyActiveSubscription: (...args: unknown[]) =>
      getMyActiveSubscriptionMock(...args),
    getMyCredits: (...args: unknown[]) => getMyCreditsMock(...args),
    getMyOrganizationCredits: (...args: unknown[]) =>
      getMyOrganizationCreditsMock(...args),
    getMyStripeCustomer: (...args: unknown[]) =>
      getMyStripeCustomerMock(...args),
    getOrganizationBillingPlan: (...args: unknown[]) =>
      getOrganizationBillingPlanMock(...args),
    getOrganizationStripeCustomer: (...args: unknown[]) =>
      getOrganizationStripeCustomerMock(...args),
    getSubscriptionCatalog: (...args: unknown[]) =>
      getSubscriptionCatalogMock(...args),
  },
}));

vi.mock("@/lib/flags/zero-margin-top-up", () => ({
  zeroMarginTopUpEnabled: (...args: unknown[]) =>
    zeroMarginTopUpEnabledMock(...args),
}));

vi.mock("@/lib/services", () => ({
  organizationSeatService: {
    getSeatSummary: (...args: unknown[]) => getSeatSummaryMock(...args),
  },
  userService: {
    getActiveOrganization: (...args: unknown[]) =>
      getActiveOrganizationMock(...args),
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
  },
}));

vi.mock("@/lib/utils/credits", () => ({
  formatCreditsForDisplay: (credits: number) => String(credits),
}));

vi.mock("@/components/billing/enterprise-contract-summary", () => ({
  EnterpriseContractSummary: (props: { summary: unknown }) => {
    enterpriseContractSummaryMock(props);
    return <div data-testid="enterprise-contract-summary" />;
  },
}));

vi.mock("@/lib/services/enterprise-contract-summary.service", () => ({
  getEnterpriseContractBillingSummary: (...args: unknown[]) =>
    getEnterpriseContractBillingSummaryMock(...args),
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
    free: { credits: 250, currency: "EUR", monthlyAmount: 0 },
    pro: { credits: 14_000, currency: "EUR", monthlyAmount: 20_000 },
    standard: { credits: 5_250, currency: "EUR", monthlyAmount: 7_500 },
    starter: { credits: 1_750, currency: "EUR", monthlyAmount: 2_500 },
  };
}

function mockSelfServeOrganizationBillingPlan(
  plan: "free" | "pro" | "standard" | "starter",
  purchasedSeats: number,
): void {
  getOrganizationBillingPlanMock.mockResolvedValue({
    data: {
      mode: "self_serve",
      plan,
      isConsumable: false,
      purchasedSeats,
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-03-01T00:00:00.000Z"),
    },
  });
}

function mockEnterpriseOrganizationBillingPlan(
  isConsumable: boolean,
  purchasedSeats: number,
): void {
  getOrganizationBillingPlanMock.mockResolvedValue({
    data: {
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable,
      purchasedSeats,
      cancelAtPeriodEnd: false,
      periodEnd: null,
    },
  });
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
    getMyCreditsMock.mockResolvedValue({
      data: { credits: { total: 0 } },
    });
    getMyOrganizationCreditsMock.mockResolvedValue({
      data: { credits: { total: 0 } },
    });
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: {
        subscription: {
          periodEnd: "2026-03-01T00:00:00.000Z",
          plan: "pro",
          seats: 2,
          status: "active",
        },
      },
    });
    getSubscriptionCatalogMock.mockResolvedValue({
      data: createSubscriptionCatalog(),
    });
    getMyStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_user_1" },
    });
    getOrganizationStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: null },
    });
    getSeatSummaryMock.mockResolvedValue({
      assignedCount: 1,
      memberCount: 1,
      paidPlan: null,
      purchasedSeats: 1,
      unusedSeats: 0,
    });
  });

  it("passes the zero-margin override to personal billing credits when the flag is enabled", async () => {
    getActiveOrganizationMock.mockResolvedValue(null);
    zeroMarginTopUpEnabledMock.mockResolvedValue(true);
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: {
        subscription: {
          periodEnd: "2026-03-01T00:00:00.000Z",
          plan: "free",
          seats: 1,
          status: "active",
        },
      },
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
      id: "org-1",
      name: "Org One",
      slug: "org-one",
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    zeroMarginTopUpEnabledMock.mockResolvedValue(true);
    mockSelfServeOrganizationBillingPlan("free", 2);

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
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: {
        subscription: {
          periodEnd: "2026-03-01T00:00:00.000Z",
          plan: "free",
          seats: 1,
          status: "active",
        },
      },
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
      id: "org-1",
      name: "Org One",
      slug: "org-one",
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    zeroMarginTopUpEnabledMock.mockResolvedValue(false);
    mockSelfServeOrganizationBillingPlan("free", 5);
    getSeatSummaryMock.mockResolvedValue({
      assignedCount: 2,
      memberCount: 2,
      paidPlan: null,
      purchasedSeats: 5,
      unusedSeats: 3,
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
        assignedSeatCount: 2,
        cancelAtPeriodEnd: false,
        currentPlan: "free",
        currentPeriodEnd: new Date("2026-03-01T00:00:00.000Z"),
        currentSeats: 5,
        isEnterpriseConsumable: false,
        isEnterpriseContract: false,
        memberCount: 2,
      }),
    );
    expect(balanceBillingPortalLinkMock).not.toHaveBeenCalled();
    expect(view.queryByTestId("balance-billing-portal-link")).toBeNull();
  });

  it("shows the billing portal for organization plans with a Stripe customer", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: "org-1",
      name: "Org One",
      slug: "org-one",
    });
    getOrganizationStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_org_1" },
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    zeroMarginTopUpEnabledMock.mockResolvedValue(false);
    mockSelfServeOrganizationBillingPlan("pro", 10);

    const { default: BillingPage } = await import("../page");

    const view = render(
      await BillingPage({
        searchParams: Promise.resolve({
          tab: "subscription",
        }),
      }),
    );

    expect(balanceBillingPortalLinkMock).toHaveBeenCalled();
    expect(view.getByTestId("balance-billing-portal-link")).toBeTruthy();
  });

  it("renders without the billing portal when the org Stripe customer lookup 404s", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: "org-1",
      name: "Org One",
      slug: "org-one",
    });
    getOrganizationStripeCustomerMock.mockRejectedValue(
      new MockCoreApiRequestError("Organization not found", { status: 404 }),
    );
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    zeroMarginTopUpEnabledMock.mockResolvedValue(false);
    mockSelfServeOrganizationBillingPlan("pro", 10);

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

  it("shows the enterprise contract summary for consumable enterprise org billing", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: "org-enterprise",
      name: "Enterprise Org",
      slug: "enterprise-org",
    });
    getOrganizationStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_org_enterprise" },
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    zeroMarginTopUpEnabledMock.mockResolvedValue(false);
    mockEnterpriseOrganizationBillingPlan(true, 10);
    getEnterpriseContractBillingSummaryMock.mockResolvedValue({
      activatedAt: new Date("2026-01-15T00:00:00.000Z"),
      endsAt: new Date("2026-12-14T23:59:59.999Z"),
      currentPeriodEnd: new Date("2026-03-14T23:59:59.999Z"),
      isConsumable: true,
      monthlyCredits: 60_000,
      nextActivationAt: new Date("2026-03-15T00:00:00.000Z"),
      poolRemainingCredits: 25_000,
      purchasedSeats: 10,
    });

    const { default: BillingPage } = await import("../page");

    const view = render(
      await BillingPage({
        searchParams: Promise.resolve({
          tab: "subscription",
        }),
      }),
    );

    expect(getEnterpriseContractBillingSummaryMock).toHaveBeenCalledWith(
      "org-enterprise",
    );
    expect(enterpriseContractSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          poolRemainingCredits: 25_000,
          purchasedSeats: 10,
        }),
      }),
    );
    expect(view.getByTestId("enterprise-contract-summary")).toBeTruthy();
    expect(view.queryByTestId("balance-section")).toBeNull();
    expect(balanceBillingPortalLinkMock).not.toHaveBeenCalled();
  });

  it("falls back to the balance section when the enterprise summary is unavailable", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: "org-enterprise",
      name: "Enterprise Org",
      slug: "enterprise-org",
    });
    getOrganizationStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_org_enterprise" },
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    zeroMarginTopUpEnabledMock.mockResolvedValue(false);
    mockEnterpriseOrganizationBillingPlan(true, 10);
    // Core re-resolved the org to a non-enterprise plan (404 -> null) even
    // though the page locally believed it was on an enterprise contract.
    getEnterpriseContractBillingSummaryMock.mockResolvedValue(null);
    getMyOrganizationCreditsMock.mockResolvedValue({
      data: { credits: { total: 750 } },
    });

    const { default: BillingPage } = await import("../page");

    const view = render(
      await BillingPage({
        searchParams: Promise.resolve({
          tab: "subscription",
        }),
      }),
    );

    expect(getEnterpriseContractBillingSummaryMock).toHaveBeenCalledWith(
      "org-enterprise",
    );
    expect(enterpriseContractSummaryMock).not.toHaveBeenCalled();
    expect(view.queryByTestId("enterprise-contract-summary")).toBeNull();
    expect(view.getByTestId("balance-section")).toBeTruthy();
    // The real org balance is loaded for the fallback (not a hardcoded zero).
    expect(getMyOrganizationCreditsMock).toHaveBeenCalledWith("org-enterprise");
  });

  it("shows the enterprise contract summary when contract details cannot be loaded", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: "org-enterprise-missing-contract",
      name: "Enterprise Org Missing Contract",
      slug: "enterprise-org-missing-contract",
    });
    getOrganizationStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_org_enterprise_missing_contract" },
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    zeroMarginTopUpEnabledMock.mockResolvedValue(false);
    mockEnterpriseOrganizationBillingPlan(true, 10);
    getEnterpriseContractBillingSummaryMock.mockResolvedValue({
      activatedAt: new Date("2026-01-15T00:00:00.000Z"),
      endsAt: new Date("2026-12-14T23:59:59.999Z"),
      currentPeriodEnd: null,
      isConsumable: true,
      monthlyCredits: null,
      nextActivationAt: null,
      poolRemainingCredits: 4_500,
      purchasedSeats: 10,
    });

    const { default: BillingPage } = await import("../page");

    const view = render(
      await BillingPage({
        searchParams: Promise.resolve({
          tab: "subscription",
        }),
      }),
    );

    expect(enterpriseContractSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          monthlyCredits: null,
          poolRemainingCredits: 4_500,
        }),
      }),
    );
    expect(view.getByTestId("enterprise-contract-summary")).toBeTruthy();
    expect(view.queryByTestId("balance-section")).toBeNull();
    expect(balanceBillingPortalLinkMock).not.toHaveBeenCalled();
  });

  it("shows the enterprise contract summary after the commercial term with contact us", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: "org-enterprise-post-term",
      name: "Enterprise Org Post Term",
      slug: "enterprise-org-post-term",
    });
    getOrganizationStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_org_enterprise_post_term" },
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    zeroMarginTopUpEnabledMock.mockResolvedValue(false);
    mockEnterpriseOrganizationBillingPlan(false, 10);
    getEnterpriseContractBillingSummaryMock.mockResolvedValue({
      activatedAt: new Date("2026-01-15T00:00:00.000Z"),
      endsAt: new Date("2026-12-14T23:59:59.999Z"),
      currentPeriodEnd: new Date("2026-03-14T23:59:59.999Z"),
      isConsumable: false,
      monthlyCredits: 60_000,
      nextActivationAt: null,
      poolRemainingCredits: 1_000,
      purchasedSeats: 10,
    });

    const { default: BillingPage } = await import("../page");

    const view = render(
      await BillingPage({
        searchParams: Promise.resolve({
          tab: "subscription",
        }),
      }),
    );

    expect(getEnterpriseContractBillingSummaryMock).toHaveBeenCalledWith(
      "org-enterprise-post-term",
    );
    expect(enterpriseContractSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({
          isConsumable: false,
          poolRemainingCredits: 1_000,
        }),
      }),
    );
    expect(view.getByTestId("enterprise-contract-summary")).toBeTruthy();
    expect(view.queryByTestId("balance-section")).toBeNull();
    expect(balanceBillingPortalLinkMock).not.toHaveBeenCalled();
    expect(view.queryByTestId("balance-billing-portal-link")).toBeNull();
  });
});
