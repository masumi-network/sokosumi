jest.mock("server-only", () => ({}));

const authenticateCronSecretMock = jest.fn();
const acquireLockMock = jest.fn();
const ensurePersonalFreeSubscriptionMock = jest.fn();
const unlockByKeyMock = jest.fn();
const getSyncMetadataByKeyMock = jest.fn();
const setSyncMetadataByKeyMock = jest.fn();
const getUsersBatchAfterCursorMock = jest.fn();

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
  syncMetadataRepository: {
    getSyncMetadataByKey: (...args: unknown[]) =>
      getSyncMetadataByKeyMock(...args),
    setSyncMetadataByKey: (...args: unknown[]) =>
      setSyncMetadataByKeyMock(...args),
  },
  userRepository: {
    getUsersBatchAfterCursor: (...args: unknown[]) =>
      getUsersBatchAfterCursorMock(...args),
  },
}));

const prismaMock = {};

jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock("p-limit", () => ({
  __esModule: true,
  default: () => (fn: () => Promise<unknown>) => fn(),
}));

describe("GET /api/sync/stripe-free-user-subscription", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authenticateCronSecretMock.mockReturnValue({ ok: true });
    acquireLockMock.mockResolvedValue({ key: "lock-key" });
    getSyncMetadataByKeyMock.mockResolvedValue({
      cursorId: null,
      lastSyncedAt: new Date(0),
    });
    getUsersBatchAfterCursorMock.mockResolvedValue([]);
    setSyncMetadataByKeyMock.mockResolvedValue(undefined);
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
    getUsersBatchAfterCursorMock.mockResolvedValue([
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
      completed: false,
      failed: 1,
      nextCursorId: "user-3",
      scanned: 3,
      skipped: 1,
    });
    expect(ensurePersonalFreeSubscriptionMock).toHaveBeenCalledTimes(3);
    expect(getUsersBatchAfterCursorMock).toHaveBeenCalledWith(
      null,
      100,
      expect.any(Object),
    );
    expect(setSyncMetadataByKeyMock).toHaveBeenCalledWith(
      "stripe-free-user-subscription-sync",
      "user-3",
      new Date(0),
      expect.any(Object),
    );
    expect(unlockByKeyMock).toHaveBeenCalledWith(
      "lock-key",
      expect.any(Object),
    );
  });

  it("resumes from an existing cursor", async () => {
    getSyncMetadataByKeyMock.mockResolvedValue({
      cursorId: "user-3",
      lastSyncedAt: new Date(0),
    });
    getUsersBatchAfterCursorMock.mockResolvedValue([{ id: "user-4" }]);
    ensurePersonalFreeSubscriptionMock.mockResolvedValue({
      status: "skipped",
      reason: "ALREADY_HAS_SUBSCRIPTION",
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/test"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      created: 0,
      completed: false,
      failed: 0,
      nextCursorId: "user-4",
      scanned: 1,
      skipped: 1,
    });
    expect(getUsersBatchAfterCursorMock).toHaveBeenCalledWith(
      "user-3",
      100,
      expect.any(Object),
    );
    expect(setSyncMetadataByKeyMock).toHaveBeenCalledWith(
      "stripe-free-user-subscription-sync",
      "user-4",
      new Date(0),
      expect.any(Object),
    );
  });

  it("marks the one-pass sync as completed when there are no more users", async () => {
    getSyncMetadataByKeyMock.mockResolvedValue({
      cursorId: "user-10",
      lastSyncedAt: new Date(0),
    });
    getUsersBatchAfterCursorMock.mockResolvedValue([]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/test"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      created: 0,
      completed: true,
      failed: 0,
      nextCursorId: null,
      scanned: 0,
      skipped: 0,
    });
    expect(ensurePersonalFreeSubscriptionMock).not.toHaveBeenCalled();
    expect(setSyncMetadataByKeyMock).toHaveBeenCalledWith(
      "stripe-free-user-subscription-sync",
      null,
      expect.any(Date),
      expect.any(Object),
    );
  });

  it("does not reprocess users after completion", async () => {
    getSyncMetadataByKeyMock.mockResolvedValue({
      cursorId: null,
      lastSyncedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/test"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      created: 0,
      completed: true,
      failed: 0,
      nextCursorId: null,
      scanned: 0,
      skipped: 0,
    });
    expect(getUsersBatchAfterCursorMock).not.toHaveBeenCalled();
    expect(setSyncMetadataByKeyMock).not.toHaveBeenCalled();
    expect(ensurePersonalFreeSubscriptionMock).not.toHaveBeenCalled();
  });

  it("always unlocks when sync fails", async () => {
    getSyncMetadataByKeyMock.mockRejectedValue(new Error("db failed"));

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/test"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      message: "Failed to sync free user subscriptions",
    });
    expect(unlockByKeyMock).toHaveBeenCalledWith(
      "lock-key",
      expect.any(Object),
    );
  });
});
