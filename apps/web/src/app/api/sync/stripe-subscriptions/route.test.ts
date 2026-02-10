jest.mock("server-only", () => ({}));

const authenticateCronSecretMock = jest.fn();
const acquireLockMock = jest.fn();
const unlockByKeyMock = jest.fn();
const getUsersWithStripeCustomerIdMock = jest.fn();
const syncSubscriptionRowsForReferenceMock = jest.fn();

jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return {
    ...actual,
    after: (callback: () => Promise<void> | void) => {
      void callback();
    },
  };
});

jest.mock("@/lib/auth/utils", () => ({
  authenticateCronSecret: (...args: unknown[]) =>
    authenticateCronSecretMock(...args),
}));

jest.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    INSTANCE_ID: "instance-test",
    LOCK_TIMEOUT: 120000,
    LOCK_TIMEOUT_BUFFER: 25000,
  }),
}));

jest.mock("@sokosumi/database/repositories", () => ({
  lockRepository: {
    unlockByKey: (...args: unknown[]) => unlockByKeyMock(...args),
  },
  userRepository: {
    getUsersWithStripeCustomerId: (...args: unknown[]) =>
      getUsersWithStripeCustomerIdMock(...args),
  },
}));

jest.mock("@/lib/services", () => ({
  lockService: {
    acquireLock: (...args: unknown[]) => acquireLockMock(...args),
  },
  stripeService: {
    syncSubscriptionRowsForReference: (...args: unknown[]) =>
      syncSubscriptionRowsForReferenceMock(...args),
  },
}));

jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    organization: {},
    user: {},
  },
}));

jest.mock("p-limit", () => ({
  __esModule: true,
  default: () => (fn: () => Promise<unknown>) => fn(),
}));

jest.mock("p-timeout", () => ({
  __esModule: true,
  default: async <T>(promise: Promise<T>) => await promise,
}));

describe("GET /api/sync/stripe-subscriptions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticateCronSecretMock.mockReturnValue({ ok: true });
    acquireLockMock.mockResolvedValue({ key: "lock-key" });
    unlockByKeyMock.mockResolvedValue(undefined);
    getUsersWithStripeCustomerIdMock.mockResolvedValue([]);
    syncSubscriptionRowsForReferenceMock.mockResolvedValue({
      created: 0,
      skipped: 0,
      updated: 0,
    });
  });

  it("returns cron auth error response when secret is invalid", async () => {
    authenticateCronSecretMock.mockReturnValue({
      ok: false,
      response: new Response(
        JSON.stringify({ message: "Invalid cron secret" }),
        {
          status: 401,
        },
      ),
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/test"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Invalid cron secret" });
    expect(acquireLockMock).not.toHaveBeenCalled();
  });

  it("returns 409 when lock is already acquired", async () => {
    acquireLockMock.mockRejectedValue(new Error("LOCK_IS_LOCKED"));

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/test"));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: "Syncing already in progress",
    });
  });

  it("runs sync for all users with stripe customer ids", async () => {
    getUsersWithStripeCustomerIdMock.mockResolvedValue([
      { id: "user-1", stripeCustomerId: "cus_user_1" },
      { id: "user-2", stripeCustomerId: "cus_user_2" },
    ]);
    syncSubscriptionRowsForReferenceMock
      .mockResolvedValueOnce({ created: 1, skipped: 0, updated: 0 })
      .mockResolvedValueOnce({ created: 0, skipped: 1, updated: 0 });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/test"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Syncing started" });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(syncSubscriptionRowsForReferenceMock).toHaveBeenCalledTimes(2);
    expect(syncSubscriptionRowsForReferenceMock).toHaveBeenNthCalledWith(
      1,
      "user-1",
      "cus_user_1",
    );
    expect(syncSubscriptionRowsForReferenceMock).toHaveBeenNthCalledWith(
      2,
      "user-2",
      "cus_user_2",
    );
    expect(unlockByKeyMock).toHaveBeenCalledWith(
      "lock-key",
      expect.objectContaining({
        user: expect.any(Object),
      }),
    );
  });
});
