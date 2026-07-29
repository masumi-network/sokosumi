import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getMyActiveSubscriptionMock,
  getMyOrganizationsMock,
  getOrganizationBillingPlanMock,
  provisionHermesInstanceMock,
  MockCoreApiRequestError,
  toCoreApiActionErrorMock,
  mockSessionRole,
} = vi.hoisted(() => {
  class MockCoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  }

  return {
    getMyActiveSubscriptionMock: vi.fn(),
    getMyOrganizationsMock: vi.fn(),
    getOrganizationBillingPlanMock: vi.fn(),
    provisionHermesInstanceMock: vi.fn(),
    MockCoreApiRequestError,
    toCoreApiActionErrorMock: vi.fn(),
    mockSessionRole: { current: undefined as string | undefined },
  };
});

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      await handler({
        ...params,
        session: {
          user: {
            id: "user-1",
            email: "ada@example.com",
            role: mockSessionRole.current,
          },
          session: { activeOrganizationId: null },
        },
      } as TParams),
}));

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  coreClient: {
    getMyActiveSubscription: (...args: unknown[]) =>
      getMyActiveSubscriptionMock(...args),
    getMyOrganizations: (...args: unknown[]) => getMyOrganizationsMock(...args),
    getOrganizationBillingPlan: (...args: unknown[]) =>
      getOrganizationBillingPlanMock(...args),
    provisionHermesInstance: (...args: unknown[]) =>
      provisionHermesInstanceMock(...args),
  },
  toCoreApiActionError: (...args: unknown[]) =>
    toCoreApiActionErrorMock(...args),
}));

import { provisionHermesAction } from "@/lib/actions/hermes";

const RUNNING_INSTANCE = {
  status: "running",
  endpointUrl: null,
  lastActivityAt: null,
  onboardedAt: null,
  assistantName: null,
  avatarSeed: null,
  personality: null,
  autonomyLevel: "medium",
  integrations: [],
  transitioning: false,
  lastSokosumiSyncAt: null,
  lastInboxRefreshAt: null,
  timezone: null,
  pendingConfirmations: [],
};

describe("provisionHermesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionRole.current = undefined;
    provisionHermesInstanceMock.mockResolvedValue({ data: RUNNING_INSTANCE });
    getMyOrganizationsMock.mockResolvedValue({ data: [] });
    getOrganizationBillingPlanMock.mockResolvedValue(null);
  });

  it("blocks provisioning on the free plan without calling Core", async () => {
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: { plan: "free" } },
    });

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SUBSCRIPTION_REQUIRED");
    }
    expect(provisionHermesInstanceMock).not.toHaveBeenCalled();
  });

  it("blocks provisioning when there is no subscription at all", async () => {
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: null },
    });

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SUBSCRIPTION_REQUIRED");
    }
    expect(provisionHermesInstanceMock).not.toHaveBeenCalled();
  });

  it("fails closed when the credits lookup errors", async () => {
    getMyActiveSubscriptionMock.mockRejectedValue(new Error("network blip"));
    getMyOrganizationsMock.mockRejectedValue(new Error("network blip"));

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SUBSCRIPTION_REQUIRED");
    }
    expect(provisionHermesInstanceMock).not.toHaveBeenCalled();
  });

  it("refuses a paid plan below the Standard floor", async () => {
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: { plan: "starter" } },
    });

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SUBSCRIPTION_REQUIRED");
    }
    expect(provisionHermesInstanceMock).not.toHaveBeenCalled();
  });

  it("provisions when the user is on Standard", async () => {
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: { plan: "standard" } },
    });

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(true);
    expect(provisionHermesInstanceMock).toHaveBeenCalledTimes(1);
  });

  it("provisions when a member organization is on an enterprise contract", async () => {
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: null },
    });
    getMyOrganizationsMock.mockResolvedValue({
      data: [{ id: "org_ent", name: "Enterprise Org" }],
    });
    getOrganizationBillingPlanMock.mockResolvedValue({
      data: {
        mode: "enterprise_contract",
        plan: "enterprise",
        isConsumable: true,
      },
    });

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(true);
    expect(provisionHermesInstanceMock).toHaveBeenCalledTimes(1);
    expect(getOrganizationBillingPlanMock).toHaveBeenCalledWith("org_ent");
  });

  it("blocks provisioning when the only org plan is below the Standard floor", async () => {
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: null },
    });
    getMyOrganizationsMock.mockResolvedValue({
      data: [{ id: "org_starter", name: "Starter Org" }],
    });
    getOrganizationBillingPlanMock.mockResolvedValue({
      data: {
        mode: "self_serve",
        plan: "starter",
      },
    });

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SUBSCRIPTION_REQUIRED");
    }
    expect(provisionHermesInstanceMock).not.toHaveBeenCalled();
    expect(getOrganizationBillingPlanMock).toHaveBeenCalledWith("org_starter");
  });

  it("blocks provisioning when the enterprise contract is past its commercial term", async () => {
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: null },
    });
    getMyOrganizationsMock.mockResolvedValue({
      data: [{ id: "org_ent", name: "Enterprise Org" }],
    });
    getOrganizationBillingPlanMock.mockResolvedValue({
      data: {
        mode: "enterprise_contract",
        plan: "enterprise",
        isConsumable: false,
      },
    });

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SUBSCRIPTION_REQUIRED");
    }
    expect(provisionHermesInstanceMock).not.toHaveBeenCalled();
  });

  it("lets an admin provision on the free plan", async () => {
    mockSessionRole.current = "admin";
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: { plan: "free" } },
    });

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(true);
    expect(provisionHermesInstanceMock).toHaveBeenCalledTimes(1);
  });

  it("still blocks a non-admin role on the free plan", async () => {
    mockSessionRole.current = "support";
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: { plan: "free" } },
    });

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SUBSCRIPTION_REQUIRED");
    }
    expect(provisionHermesInstanceMock).not.toHaveBeenCalled();
  });
});
