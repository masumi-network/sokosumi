import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  lockFindUniqueOrThrowMock,
  lockUpdateManyMock,
  lockUpdateMock,
  lockUpsertMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  lockFindUniqueOrThrowMock: vi.fn(),
  lockUpdateManyMock: vi.fn(),
  lockUpdateMock: vi.fn(),
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
            findUniqueOrThrow: lockFindUniqueOrThrowMock,
            updateMany: lockUpdateManyMock,
            upsert: lockUpsertMock,
            update: lockUpdateMock,
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

    lockUpsertMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: false,
      lockedAt: null,
    });
    lockUpdateManyMock.mockResolvedValue({ count: 1 });
    lockFindUniqueOrThrowMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: true,
      lockedBy: "instance-test",
      lockedAt: acquiredAt,
    });

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
        lockedBy: "instance-test",
        lockedAt: acquiredAt,
      },
    });
    expect(lockFindUniqueOrThrowMock).toHaveBeenCalledWith({
      where: { key: "agents-sync" },
    });
    expect(lock).toEqual(
      expect.objectContaining({
        isLocked: true,
        lockedBy: "instance-test",
      }),
    );
  });

  it("throws when lock is active and not expired", async () => {
    const syncLockService = await getSyncLockService();
    lockUpsertMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: true,
      lockedAt: new Date(),
    });
    lockUpdateManyMock.mockResolvedValue({ count: 0 });

    await expect(syncLockService.acquireLock("agents-sync")).rejects.toThrow(
      "LOCK_IS_LOCKED",
    );

    expect(lockFindUniqueOrThrowMock).not.toHaveBeenCalled();
    expect(lockUpdateMock).not.toHaveBeenCalled();
  });

  it("acquires lock when a stale lock exists", async () => {
    const syncLockService = await getSyncLockService();
    const acquiredAt = new Date("2026-02-24T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(acquiredAt);

    lockUpsertMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: true,
      lockedAt: new Date("2026-02-24T11:55:00.000Z"),
    });
    lockUpdateManyMock.mockResolvedValue({ count: 1 });
    lockFindUniqueOrThrowMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: true,
      lockedBy: "instance-test",
      lockedAt: acquiredAt,
    });

    await syncLockService.acquireLock("agents-sync");

    expect(lockUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          key: "agents-sync",
        }),
      }),
    );
  });

  it("releases a lock by key", async () => {
    const syncLockService = await getSyncLockService();
    lockUpdateMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: false,
      lockedAt: null,
      lockedBy: null,
    });

    await syncLockService.releaseLock("agents-sync");

    expect(lockUpdateMock).toHaveBeenCalledWith({
      where: { key: "agents-sync" },
      data: {
        isLocked: false,
        lockedBy: null,
        lockedAt: null,
      },
    });
  });
});
