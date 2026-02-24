import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  lockUpdateMock,
  lockUpsertMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
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
            upsert: lockUpsertMock,
            update: lockUpdateMock,
          },
        });
      },
    );
  });

  it("creates and acquires a lock when lock does not exist", async () => {
    const syncLockService = await getSyncLockService();
    lockUpsertMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: false,
      lockedAt: null,
    });
    lockUpdateMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: true,
      lockedBy: "instance-test",
    });

    const lock = await syncLockService.acquireLock("agents-sync");

    expect(lockUpsertMock).toHaveBeenCalledWith({
      where: { key: "agents-sync" },
      create: { key: "agents-sync" },
      update: {},
    });
    expect(lockUpdateMock).toHaveBeenCalledWith({
      where: { key: "agents-sync" },
      data: expect.objectContaining({
        isLocked: true,
        lockedBy: "instance-test",
        lockedAt: expect.any(Date),
      }),
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

    await expect(syncLockService.acquireLock("agents-sync")).rejects.toThrow(
      "LOCK_IS_LOCKED",
    );

    expect(lockUpdateMock).not.toHaveBeenCalled();
  });

  it("recovers an expired lock and reacquires it", async () => {
    const syncLockService = await getSyncLockService();
    const expired = new Date(Date.now() - 130000);
    lockUpsertMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: true,
      lockedAt: expired,
    });
    lockUpdateMock
      .mockResolvedValueOnce({
        key: "agents-sync",
        isLocked: false,
        lockedAt: null,
        lockedBy: null,
      })
      .mockResolvedValueOnce({
        key: "agents-sync",
        isLocked: true,
        lockedBy: "instance-test",
        lockedAt: new Date(),
      });

    await syncLockService.acquireLock("agents-sync");

    expect(lockUpdateMock).toHaveBeenNthCalledWith(1, {
      where: { key: "agents-sync" },
      data: {
        isLocked: false,
        lockedBy: null,
        lockedAt: null,
      },
    });
    expect(lockUpdateMock).toHaveBeenNthCalledWith(2, {
      where: { key: "agents-sync" },
      data: expect.objectContaining({
        isLocked: true,
        lockedBy: "instance-test",
        lockedAt: expect.any(Date),
      }),
    });
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
