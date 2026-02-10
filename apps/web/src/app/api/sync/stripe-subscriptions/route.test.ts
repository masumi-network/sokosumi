jest.mock("server-only", () => ({}));

const authenticateCronSecretMock = jest.fn();
const acquireLockMock = jest.fn();
const unlockByKeyMock = jest.fn();
const getUsersWithStripeCustomerIdMock = jest.fn();
const listAllSubscriptionsMock = jest.fn();
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

jest.mock("@/lib/clients/stripe.client", () => ({
  stripeClient: {
    listAllSubscriptions: (...args: unknown[]) =>
      listAllSubscriptionsMock(...args),
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
    listAllSubscriptionsMock.mockResolvedValue([]);
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

  it("syncs only users with matching Stripe subscriptions", async () => {
    getUsersWithStripeCustomerIdMock.mockResolvedValue([
      { id: "user-1", stripeCustomerId: "cus_user_1" },
      { id: "user-2", stripeCustomerId: "cus_user_2" },
    ]);
    listAllSubscriptionsMock.mockResolvedValue([
      {
        customer: "cus_user_1",
        id: "sub_1",
      },
      {
        customer: "cus_unknown",
        id: "sub_unknown",
      },
    ]);
    syncSubscriptionRowsForReferenceMock.mockResolvedValue({
      created: 1,
      skipped: 0,
      updated: 0,
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/test"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Syncing started" });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listAllSubscriptionsMock).toHaveBeenCalledTimes(1);
    expect(syncSubscriptionRowsForReferenceMock).toHaveBeenCalledTimes(1);
    expect(syncSubscriptionRowsForReferenceMock).toHaveBeenCalledWith(
      "user-1",
      "cus_user_1",
      [
        expect.objectContaining({
          id: "sub_1",
        }),
      ],
    );
    expect(unlockByKeyMock).toHaveBeenCalledWith(
      "lock-key",
      expect.objectContaining({
        user: expect.any(Object),
      }),
    );
  });
});
