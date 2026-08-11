import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getMyMembersWithOrganizationsMock = vi.fn();
const hasPaidPlanCoverageMock = vi.fn();
const getSubscriptionCatalogMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getSubscriptionCatalog: (...args: unknown[]) =>
      getSubscriptionCatalogMock(...args),
  },
}));

vi.mock("@/lib/hermes/paid-plan-coverage", () => ({
  hasPaidPlanCoverage: (...args: unknown[]) => hasPaidPlanCoverageMock(...args),
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMembersWithOrganizations: (...args: unknown[]) =>
      getMyMembersWithOrganizationsMock(...args),
  },
}));

vi.mock("@/app/personal-assistant/components/hermes-experience", () => ({
  default: function HermesExperienceMock() {
    return <div data-testid="hermes-experience" />;
  },
}));

vi.mock("@/app/personal-assistant/components/loading-state", () => ({
  default: function LoadingStateMock() {
    return <div data-testid="loading-state" />;
  },
}));

function createSession(overrides?: {
  role?: string;
  userId?: string;
  email?: string;
}) {
  return {
    user: {
      id: overrides?.userId ?? "user-1",
      name: "Ada",
      email: overrides?.email ?? "ada@example.com",
      image: null,
      role: overrides?.role ?? "user",
    },
    session: {
      activeOrganizationId: "org-1",
    },
  };
}

function findHermesExperienceElement(
  node: ReactNode,
): ReactElement | undefined {
  if (!isValidElement(node)) return undefined;
  if (typeof node.type === "function") {
    const name =
      (node.type as { name?: string }).name ??
      (node.type as { displayName?: string }).displayName;
    if (name === "HermesExperienceWithAccess") {
      return node as ReactElement;
    }
  }
  const props = node.props as { children?: ReactNode };
  if (props?.children == null) return undefined;
  if (Array.isArray(props.children)) {
    for (const child of props.children) {
      const found = findHermesExperienceElement(child);
      if (found) return found;
    }
    return undefined;
  }
  return findHermesExperienceElement(props.children);
}

describe("HermesPage first paint + billing gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue(createSession());
    getMyMembersWithOrganizationsMock.mockResolvedValue([
      {
        organization: {
          id: "org-1",
          name: "Acme",
          slug: "acme",
        },
      },
    ]);
    hasPaidPlanCoverageMock.mockResolvedValue(false);
    getSubscriptionCatalogMock.mockResolvedValue({
      data: {
        free: { credits: 250, currency: "eur", monthlyAmount: 0 },
        starter: { credits: 1_750, currency: "eur", monthlyAmount: 2_500 },
        standard: { credits: 5_250, currency: "eur", monthlyAmount: 7_500 },
        pro: { credits: 14_000, currency: "eur", monthlyAmount: 20_000 },
      },
    });
  });

  it("returns Suspense shell without awaiting coverage or catalog", async () => {
    let resolveCoverage!: (value: boolean) => void;
    hasPaidPlanCoverageMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveCoverage = resolve;
      }),
    );
    getSubscriptionCatalogMock.mockReturnValue(
      new Promise(() => {
        /* intentionally never resolves during this assertion */
      }),
    );

    const { default: HermesPage } = await import("../page");
    const tree = await HermesPage();

    // Shell returned while billing promises are still pending.
    expect(hasPaidPlanCoverageMock).not.toHaveBeenCalled();
    expect(getSubscriptionCatalogMock).not.toHaveBeenCalled();
    expect(isValidElement(tree)).toBe(true);

    // Cleanup pending promise so Vitest does not hang on open handles.
    resolveCoverage(false);
  });

  it("passes fail-closed hasActiveSubscription when coverage is false", async () => {
    hasPaidPlanCoverageMock.mockResolvedValue(false);
    const { HermesExperienceWithAccess } = await import("../page");

    const element = await HermesExperienceWithAccess({
      userId: "user-1",
      userName: "Ada",
      userEmail: "ada@example.com",
      userImageUrl: null,
      activeOrganizationId: "org-1",
      userRole: "user",
    });

    expect(hasPaidPlanCoverageMock).toHaveBeenCalledWith({
      organizationIds: ["org-1"],
    });
    expect(isValidElement(element)).toBe(true);
    expect(element.props).toEqual(
      expect.objectContaining({
        hasActiveSubscription: false,
        subscriptionWallPlans: [
          {
            name: "starter",
            monthlyAmount: 2_500,
            currency: "eur",
            credits: 1_750,
          },
          {
            name: "standard",
            monthlyAmount: 7_500,
            currency: "eur",
            credits: 5_250,
          },
          {
            name: "pro",
            monthlyAmount: 20_000,
            currency: "eur",
            credits: 14_000,
          },
        ],
        organizations: [{ id: "org-1", name: "Acme", slug: "acme" }],
      }),
    );
  });

  it("passes hasActiveSubscription true when coverage resolves paid", async () => {
    hasPaidPlanCoverageMock.mockResolvedValue(true);
    const { HermesExperienceWithAccess } = await import("../page");

    const element = await HermesExperienceWithAccess({
      userId: "user-1",
      userName: "Ada",
      userEmail: "ada@example.com",
      userImageUrl: null,
      activeOrganizationId: null,
      userRole: "user",
    });

    expect(isValidElement(element)).toBe(true);
    expect(element.props).toEqual(
      expect.objectContaining({
        hasActiveSubscription: true,
      }),
    );
  });

  it("admin bypasses wall when coverage is false", async () => {
    hasPaidPlanCoverageMock.mockResolvedValue(false);
    const { HermesExperienceWithAccess } = await import("../page");

    const element = await HermesExperienceWithAccess({
      userId: "admin-1",
      userName: "Admin",
      userEmail: "admin@example.com",
      userImageUrl: null,
      activeOrganizationId: null,
      userRole: "admin",
    });

    expect(isValidElement(element)).toBe(true);
    expect(element.props).toEqual(
      expect.objectContaining({
        hasActiveSubscription: true,
      }),
    );
  });

  it("default page places HermesExperienceWithAccess under Suspense", async () => {
    const { default: HermesPage } = await import("../page");
    const tree = await HermesPage();
    const child = findHermesExperienceElement(tree);
    expect(child).toBeTruthy();
  });
});
