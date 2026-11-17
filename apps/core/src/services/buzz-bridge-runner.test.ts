import { beforeEach, describe, expect, it, vi } from "vitest";

const lock = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  renewLock: vi.fn(),
  releaseLock: vi.fn(),
}));
vi.mock("@/services/sync-lock.service", () => ({ syncLockService: lock }));
vi.mock("@/services/buzz-history-import.service", () => ({
  importBuzzHistory: vi.fn(),
  importDepartedMessage: vi.fn(),
}));
vi.mock("@/services/buzz-bridge.service", () => ({
  buzzConfig: () => ({ operatorPubkey: "a".repeat(64) }),
  buzzSubscriptions: vi.fn(async () => []),
  claimBuzzState: vi.fn(async () => true),
  CoreRejectedError: class extends Error {
    constructor(
      readonly status: number,
      readonly terminal: boolean,
    ) {
      super(`core ${status}`);
    }
  },
}));

import { CoreRejectedError } from "@/services/buzz-bridge.service";

import { rejectedForGood, runLeasedBuzzBridge } from "./buzz-bridge-runner";

const locked = () => Object.assign(new Error("LOCK_IS_LOCKED"));
const core = vi.fn();

describe("runLeasedBuzzBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lock.releaseLock.mockResolvedValue(true);
  });

  it("waits for the run that is finishing, then runs and hands the lease back", async () => {
    lock.acquireLock
      .mockRejectedValueOnce(locked())
      .mockResolvedValueOnce({ key: "buzz-bridge", ownerToken: "me" });
    const log = vi.fn();
    await expect(
      runLeasedBuzzBridge({ core, log, until: Date.now(), waitMs: 5_000 }),
    ).resolves.toBe(true);
    expect(lock.acquireLock).toHaveBeenCalledTimes(2);
    expect(lock.acquireLock).toHaveBeenCalledWith("buzz-bridge", 90_000);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^running as/));
    expect(lock.releaseLock).toHaveBeenCalledWith("buzz-bridge", "me");
  });

  it("gives up when another run keeps the lease past the wait", async () => {
    lock.acquireLock.mockRejectedValue(locked());
    const log = vi.fn();
    await expect(
      runLeasedBuzzBridge({ core, log, until: Date.now(), waitMs: 0 }),
    ).resolves.toBe(false);
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/^running/));
    expect(lock.releaseLock).not.toHaveBeenCalled();
  });

  it("lets any other failure through", async () => {
    lock.acquireLock.mockRejectedValue(new Error("database down"));
    await expect(
      runLeasedBuzzBridge({ core, log: vi.fn(), until: 0, waitMs: 5_000 }),
    ).rejects.toThrow("database down");
  });
});

describe("rejectedForGood", () => {
  const rejected = (status: number, terminal: boolean) =>
    new (
      CoreRejectedError as unknown as new (
        status: number,
        terminal: boolean,
      ) => Error
    )(status, terminal);

  it("gives up at once on a terminal rejection", () => {
    expect(rejectedForGood(rejected(404, true), 0)).toBe(true);
  });

  it("retries a refused access a while, then gives up", () => {
    expect(rejectedForGood(rejected(403, false), 0)).toBe(false);
    expect(rejectedForGood(rejected(403, false), 10)).toBe(false);
    expect(rejectedForGood(rejected(403, false), 11)).toBe(true);
    expect(rejectedForGood(rejected(401, false), 11)).toBe(true);
  });

  it("keeps retrying when Core is unreachable or busy", () => {
    expect(rejectedForGood(rejected(429, false), 50)).toBe(false);
    expect(rejectedForGood(new Error("fetch failed"), 50)).toBe(false);
  });
});
