import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  lockUpdateManyMock,
  lockUpdateManyRootMock,
  lockUpsertMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  lockUpdateManyMock: vi.fn(),
  lockUpdateManyRootMock: vi.fn(),
  lockUpsertMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    LOCK_TIMEOUT: 120000,
    INSTANCE_ID: "instance-test",
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    lock: {
      updateMany: lockUpdateManyRootMock,
    },
  },
}));

async function getSyncLockService() {
  const module = await import("./sync-lock.service");
  return module.syncLockService;
}

describe("syncLockService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        return await callback({
          lock: {
            updateMany: lockUpdateManyMock,
            upsert: lockUpsertMock,
          },
        });
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates and acquires a lock when lock does not exist", async () => {
    const syncLockService = await getSyncLockService();
    const acquiredAt = new Date("2026-02-24T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(acquiredAt);

    lockUpsertMock.mockResolvedValue({ key: "agents-sync" });
    lockUpdateManyMock.mockResolvedValue({ count: 1 });

    const lock = await syncLockService.acquireLock("agents-sync");

    expect(lockUpsertMock).toHaveBeenCalledWith({
      where: { key: "agents-sync" },
      create: { key: "agents-sync" },
      update: {},
    });
    expect(lockUpdateManyMock).toHaveBeenCalledWith({
      where: {
        key: "agents-sync",
        OR: [
          { isLocked: false },
          { isLocked: true, lockedAt: null },
          {
            isLocked: true,
            lockedAt: {
              lt: new Date(acquiredAt.getTime() - 120000),
            },
          },
        ],
      },
      data: {
        isLocked: true,
        lockedBy: expect.stringMatching(/^instance-test:/),
        lockedAt: acquiredAt,
      },
    });
    expect(lock).toEqual({
      key: "agents-sync",
      ownerToken: expect.stringMatching(/^instance-test:/),
    });
  });

  it("throws when lock is active and not expired", async () => {
    const syncLockService = await getSyncLockService();
    lockUpsertMock.mockResolvedValue({ key: "agents-sync" });
    lockUpdateManyMock.mockResolvedValue({ count: 0 });

    await expect(syncLockService.acquireLock("agents-sync")).rejects.toThrow(
      "LOCK_IS_LOCKED",
    );
  });

  it("acquires lock when a stale lock exists", async () => {
    const syncLockService = await getSyncLockService();

    lockUpsertMock.mockResolvedValue({ key: "agents-sync" });
    lockUpdateManyMock.mockResolvedValue({ count: 1 });

    const lock = await syncLockService.acquireLock("agents-sync");

    expect(lockUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          key: "agents-sync",
        }),
      }),
    );
    expect(lock.ownerToken).toMatch(/^instance-test:/);
  });

  it("heartbeats only the owned active lock", async () => {
    const syncLockService = await getSyncLockService();
    lockUpdateManyRootMock.mockResolvedValue({ count: 1 });

    const result = await syncLockService.heartbeatLock(
      "agents-sync",
      "instance-test:token-1",
    );

    expect(result).toBe(true);
    expect(lockUpdateManyRootMock).toHaveBeenCalledWith({
      where: {
        key: "agents-sync",
        isLocked: true,
        lockedBy: "instance-test:token-1",
      },
      data: {
        lockedAt: expect.any(Date),
      },
    });
  });

  it("releases only when owner token matches", async () => {
    const syncLockService = await getSyncLockService();
    lockUpdateManyRootMock.mockResolvedValue({ count: 1 });

    const result = await syncLockService.releaseLock(
      "agents-sync",
      "instance-test:token-1",
    );

    expect(result).toBe(true);
    expect(lockUpdateManyRootMock).toHaveBeenCalledWith({
      where: {
        key: "agents-sync",
        isLocked: true,
        lockedBy: "instance-test:token-1",
      },
      data: {
        isLocked: false,
        lockedBy: null,
        lockedAt: null,
      },
    });
  });

  it("does not release when ownership changed", async () => {
    const syncLockService = await getSyncLockService();
    lockUpdateManyRootMock.mockResolvedValue({ count: 0 });

    const result = await syncLockService.releaseLock(
      "agents-sync",
      "instance-test:token-1",
    );

    expect(result).toBe(false);
  });
});
