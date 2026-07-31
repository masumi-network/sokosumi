import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock, getRedisClientMock, redisEvalMock, redisSetMock } =
  vi.hoisted(() => ({
    getEnvMock: vi.fn(() => ({ INSTANCE_ID: "instance-test" })),
    getRedisClientMock: vi.fn(),
    redisEvalMock: vi.fn(),
    redisSetMock: vi.fn(),
  }));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: getRedisClientMock,
}));

import {
  acquireStreamLock,
  COWORKER_STREAM_LOCK_HEARTBEAT_MS,
  COWORKER_STREAM_LOCK_TTL_SECONDS,
  coworkerStreamLockRedisKey,
  releaseStreamLock,
  renewStreamLock,
  startStreamLockHeartbeat,
} from "./coworker-stream-lock";

describe("coworker-stream-lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRedisClientMock.mockReturnValue({
      set: redisSetMock,
      eval: redisEvalMock,
    });
    redisSetMock.mockResolvedValue("OK");
    redisEvalMock.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the expected redis key", () => {
    expect(coworkerStreamLockRedisKey("conv-1")).toBe(
      "coworker:stream_lock:conv-1",
    );
  });

  it("returns unavailable when redis is not configured", async () => {
    getRedisClientMock.mockReturnValue(null);

    await expect(acquireStreamLock("conv-1")).resolves.toEqual({
      status: "unavailable",
    });
    expect(redisSetMock).not.toHaveBeenCalled();
  });

  it("acquires a lock with owner token and TTL", async () => {
    const result = await acquireStreamLock("conv-1");

    expect(result.status).toBe("acquired");
    if (result.status !== "acquired") {
      throw new Error("Expected lock to be acquired");
    }
    expect(result.ownerToken).toMatch(/^instance-test:/);
    expect(redisSetMock).toHaveBeenCalledWith(
      coworkerStreamLockRedisKey("conv-1"),
      result.ownerToken,
      "EX",
      COWORKER_STREAM_LOCK_TTL_SECONDS,
      "NX",
    );
  });

  it("returns held when the lock is already held", async () => {
    redisSetMock.mockResolvedValue(null);

    await expect(acquireStreamLock("conv-1")).resolves.toEqual({
      status: "held",
    });
  });

  it("returns error when redis is configured but acquisition fails", async () => {
    redisSetMock.mockRejectedValue(new Error("redis down"));

    await expect(acquireStreamLock("conv-1")).resolves.toEqual({
      status: "error",
    });
  });

  it("renews only when owner token matches", async () => {
    const renewed = await renewStreamLock("conv-1", "instance-test:token-1");

    expect(renewed).toBe(true);
    expect(redisEvalMock).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("expire"'),
      1,
      coworkerStreamLockRedisKey("conv-1"),
      "instance-test:token-1",
      String(COWORKER_STREAM_LOCK_TTL_SECONDS),
    );
  });

  it("releases only when owner token matches", async () => {
    const released = await releaseStreamLock("conv-1", "instance-test:token-1");

    expect(released).toBe(true);
    expect(redisEvalMock).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("del"'),
      1,
      coworkerStreamLockRedisKey("conv-1"),
      "instance-test:token-1",
    );
  });

  it("heartbeat renews the lock on an interval", async () => {
    vi.useFakeTimers();
    const stop = startStreamLockHeartbeat("conv-1", "instance-test:token-1");
    await vi.advanceTimersByTimeAsync(COWORKER_STREAM_LOCK_HEARTBEAT_MS);

    expect(redisEvalMock).toHaveBeenCalled();
    stop();
  });

  it("heartbeat invokes onRenew after lock renew", async () => {
    vi.useFakeTimers();
    const onRenew = vi.fn().mockResolvedValue(undefined);
    const stop = startStreamLockHeartbeat("conv-1", "instance-test:token-1", {
      onRenew,
    });
    await vi.advanceTimersByTimeAsync(COWORKER_STREAM_LOCK_HEARTBEAT_MS);

    expect(redisEvalMock).toHaveBeenCalled();
    expect(onRenew).toHaveBeenCalledTimes(1);
    stop();
  });
});
