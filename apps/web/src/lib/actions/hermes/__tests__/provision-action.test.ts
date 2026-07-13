import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getMyCreditsMock,
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
    getMyCreditsMock: vi.fn(),
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
    getMyCredits: (...args: unknown[]) => getMyCreditsMock(...args),
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
  });

  it("blocks provisioning on the free plan without calling Core", async () => {
    getMyCreditsMock.mockResolvedValue({
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
    getMyCreditsMock.mockResolvedValue({ data: { subscription: null } });

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SUBSCRIPTION_REQUIRED");
    }
    expect(provisionHermesInstanceMock).not.toHaveBeenCalled();
  });

  it("fails closed when the credits lookup errors", async () => {
    getMyCreditsMock.mockRejectedValue(new Error("network blip"));

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SUBSCRIPTION_REQUIRED");
    }
    expect(provisionHermesInstanceMock).not.toHaveBeenCalled();
  });

  it("provisions when the user has a paid plan", async () => {
    getMyCreditsMock.mockResolvedValue({
      data: { subscription: { plan: "starter" } },
    });

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(true);
    expect(provisionHermesInstanceMock).toHaveBeenCalledTimes(1);
  });

  it("lets an admin provision on the free plan", async () => {
    mockSessionRole.current = "admin";
    getMyCreditsMock.mockResolvedValue({
      data: { subscription: { plan: "free" } },
    });

    const result = await provisionHermesAction({});

    expect(result.ok).toBe(true);
    expect(provisionHermesInstanceMock).toHaveBeenCalledTimes(1);
  });

  it("still blocks a non-admin role on the free plan", async () => {
    mockSessionRole.current = "support";
    getMyCreditsMock.mockResolvedValue({
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
