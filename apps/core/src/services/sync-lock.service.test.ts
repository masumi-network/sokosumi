import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createLockByKeyMock,
  getLockByKeyMock,
  lockByKeyMock,
  prismaTransactionMock,
  unlockByKeyMock,
} = vi.hoisted(() => ({
  createLockByKeyMock: vi.fn(),
  getLockByKeyMock: vi.fn(),
  lockByKeyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  unlockByKeyMock: vi.fn(),
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

vi.mock("@sokosumi/database/repositories", () => ({
  lockRepository: {
    createLockByKey: createLockByKeyMock,
    getLockByKey: getLockByKeyMock,
    lockByKey: lockByKeyMock,
    unlockByKey: unlockByKeyMock,
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
        return await callback({});
      },
    );
  });

  it("creates and acquires a lock when lock does not exist", async () => {
    const syncLockService = await getSyncLockService();
    getLockByKeyMock.mockResolvedValueOnce(null);
    createLockByKeyMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: false,
      lockedAt: null,
    });
    lockByKeyMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: true,
      lockedBy: "instance-test",
    });

    const lock = await syncLockService.acquireLock("agents-sync");

    expect(createLockByKeyMock).toHaveBeenCalledWith("agents-sync", {});
    expect(lockByKeyMock).toHaveBeenCalledWith("agents-sync", "instance-test", {});
    expect(lock).toEqual(
      expect.objectContaining({
        isLocked: true,
        lockedBy: "instance-test",
      }),
    );
  });

  it("throws when lock is active and not expired", async () => {
    const syncLockService = await getSyncLockService();
    getLockByKeyMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: true,
      lockedAt: new Date(),
    });

    await expect(syncLockService.acquireLock("agents-sync")).rejects.toThrow(
      "LOCK_IS_LOCKED",
    );

    expect(lockByKeyMock).not.toHaveBeenCalled();
    expect(unlockByKeyMock).not.toHaveBeenCalled();
  });

  it("recovers an expired lock and reacquires it", async () => {
    const syncLockService = await getSyncLockService();
    const expired = new Date(Date.now() - 130000);
    getLockByKeyMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: true,
      lockedAt: expired,
    });
    unlockByKeyMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: false,
      lockedAt: null,
    });
    lockByKeyMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: true,
      lockedBy: "instance-test",
    });

    await syncLockService.acquireLock("agents-sync");

    expect(unlockByKeyMock).toHaveBeenCalledWith("agents-sync", {});
    expect(lockByKeyMock).toHaveBeenCalledWith("agents-sync", "instance-test", {});
  });

  it("releases a lock by key", async () => {
    const syncLockService = await getSyncLockService();
    unlockByKeyMock.mockResolvedValue({
      key: "agents-sync",
      isLocked: false,
      lockedAt: null,
      lockedBy: null,
    });

    await syncLockService.releaseLock("agents-sync");

    expect(unlockByKeyMock).toHaveBeenCalledWith("agents-sync", {});
  });
});
