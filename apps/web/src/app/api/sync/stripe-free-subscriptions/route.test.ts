jest.mock("server-only", () => ({}));

const authenticateCronSecretMock = jest.fn();
const acquireLockMock = jest.fn();
const ensurePersonalFreeSubscriptionMock = jest.fn();
const unlockByKeyMock = jest.fn();
const findManyUsersMock = jest.fn();

jest.mock("@/lib/auth/utils", () => ({
  authenticateCronSecret: (...args: unknown[]) =>
    authenticateCronSecretMock(...args),
}));

jest.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    INSTANCE_ID: "instance-test",
  }),
}));

jest.mock("@/lib/services", () => ({
  lockService: {
    acquireLock: (...args: unknown[]) => acquireLockMock(...args),
  },
  stripeService: {
    ensurePersonalFreeSubscription: (...args: unknown[]) =>
      ensurePersonalFreeSubscriptionMock(...args),
  },
}));

jest.mock("@sokosumi/database/repositories", () => ({
  lockRepository: {
    unlockByKey: (...args: unknown[]) => unlockByKeyMock(...args),
  },
}));

const prismaMock = {
  user: {
    findMany: (...args: unknown[]) => findManyUsersMock(...args),
  },
};

jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock("p-limit", () => ({
  __esModule: true,
  default: () => (fn: () => Promise<unknown>) => fn(),
}));

describe("GET /api/sync/stripe-free-subscriptions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticateCronSecretMock.mockReturnValue({ ok: true });
    acquireLockMock.mockResolvedValue({ key: "lock-key" });
    findManyUsersMock.mockResolvedValue([]);
    unlockByKeyMock.mockResolvedValue(undefined);
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

  it("returns summary counts for created/skipped/failed users", async () => {
    findManyUsersMock.mockResolvedValue([
      { id: "user-1" },
      { id: "user-2" },
      { id: "user-3" },
    ]);
    ensurePersonalFreeSubscriptionMock
      .mockResolvedValueOnce({
        status: "created",
        subscriptionId: "sub_1",
      })
      .mockResolvedValueOnce({
        status: "skipped",
        reason: "ALREADY_HAS_SUBSCRIPTION",
      })
      .mockResolvedValueOnce({
        status: "failed",
        reason: "SUBSCRIPTION_ENROLLMENT_FAILED",
      });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/test"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      created: 1,
      failed: 1,
      scanned: 3,
      skipped: 1,
    });
    expect(ensurePersonalFreeSubscriptionMock).toHaveBeenCalledTimes(3);
    expect(unlockByKeyMock).toHaveBeenCalledWith(
      "lock-key",
      expect.objectContaining({
        user: expect.any(Object),
      }),
    );
  });
});
