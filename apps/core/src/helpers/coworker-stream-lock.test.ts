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
      "coworker:stream-lock:conv-1",
    );
  });

  it("returns null when redis is unavailable", async () => {
    getRedisClientMock.mockReturnValue(null);

    await expect(acquireStreamLock("conv-1")).resolves.toBeNull();
    expect(redisSetMock).not.toHaveBeenCalled();
  });

  it("acquires a lock with owner token and TTL", async () => {
    const ownerToken = await acquireStreamLock("conv-1");

    expect(ownerToken).toMatch(/^instance-test:/);
    expect(redisSetMock).toHaveBeenCalledWith(
      coworkerStreamLockRedisKey("conv-1"),
      ownerToken,
      "EX",
      COWORKER_STREAM_LOCK_TTL_SECONDS,
      "NX",
    );
  });

  it("returns null when the lock is already held", async () => {
    redisSetMock.mockResolvedValue(null);

    await expect(acquireStreamLock("conv-1")).resolves.toBeNull();
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
    await vi.advanceTimersByTimeAsync(40_000);

    expect(redisEvalMock).toHaveBeenCalled();
    stop();
  });
});
