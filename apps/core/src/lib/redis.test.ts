import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { causeMessage, expectCoreLog } from "@/test/core-log";

const { getEnvMock, redisCtor } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  redisCtor: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("ioredis", () => ({
  default: class Redis extends EventEmitter {
    constructor(...args: unknown[]) {
      super();
      redisCtor(...args);
    }
  },
}));

describe("getRedisUrl", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns null when Redis and KV urls are unset", async () => {
    getEnvMock.mockReturnValue({});
    const { getRedisUrl } = await import("./redis");
    expect(getRedisUrl()).toBeNull();
  });

  it("prefers REDIS_URL over KV_URL", async () => {
    getEnvMock.mockReturnValue({
      REDIS_URL: "redis://primary",
      KV_URL: "redis://kv",
    });
    const { getRedisUrl } = await import("./redis");
    expect(getRedisUrl()).toBe("redis://primary");
  });

  it("falls back to KV_URL", async () => {
    getEnvMock.mockReturnValue({
      KV_URL: "redis://kv",
    });
    const { getRedisUrl } = await import("./redis");
    expect(getRedisUrl()).toBe("redis://kv");
  });

  it("treats whitespace-only REDIS_URL as missing", async () => {
    getEnvMock.mockReturnValue({
      REDIS_URL: "   ",
      KV_URL: "redis://kv",
    });
    const { getRedisUrl } = await import("./redis");
    expect(getRedisUrl()).toBe("redis://kv");
  });
});

describe("getRedisClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns null when no Redis url is configured", async () => {
    getEnvMock.mockReturnValue({});
    const { getRedisClient } = await import("./redis");
    expect(getRedisClient()).toBeNull();
    expect(redisCtor).not.toHaveBeenCalled();
  });

  it("constructs a client from getEnv REDIS_URL", async () => {
    getEnvMock.mockReturnValue({ REDIS_URL: "redis://primary" });
    const { getRedisClient } = await import("./redis");
    expect(getRedisClient()).not.toBeNull();
    expect(redisCtor).toHaveBeenCalledWith("redis://primary");
  });

  it("keeps a separate Redis client for rate limits and bounds its commands", async () => {
    getEnvMock.mockReturnValue({ REDIS_URL: "redis://primary" });
    const { getRedisClient, getRedisRateLimitClient } = await import("./redis");

    const shared = getRedisClient();
    const rateLimit = getRedisRateLimitClient();
    expect(rateLimit).not.toBe(shared);
    expect(getRedisRateLimitClient()).toBe(rateLimit);
    expect(redisCtor).toHaveBeenCalledTimes(2);
    expect(redisCtor).toHaveBeenNthCalledWith(1, "redis://primary");
    expect(redisCtor).toHaveBeenNthCalledWith(2, "redis://primary", {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      commandTimeout: 250,
    });
  });

  it.each(["shared", "rate_limit"] as const)(
    "warns once after each ready-to-error transition for the %s client",
    async (purpose) => {
      getEnvMock.mockReturnValue({ REDIS_URL: "redis://primary" });
      const warnings = expectCoreLog("warn", "Redis connection failed", 2);
      const { getRedisClient, getRedisRateLimitClient } = await import(
        "./redis"
      );
      const client =
        purpose === "shared" ? getRedisClient() : getRedisRateLimitClient();
      expect(client).not.toBeNull();
      client?.emit("error", new Error("initial connection failed"));
      client?.emit("ready");
      client?.emit("error", new Error("first connection lost"));
      client?.emit("error", new Error("reconnect failed"));
      client?.emit("ready");
      client?.emit("error", new Error("second connection lost"));

      expect(warnings.map((warning) => causeMessage(warning.cause))).toEqual([
        "first connection lost",
        "second connection lost",
      ]);
      expect(warnings.map((warning) => warning.event.redis)).toEqual([
        { purpose },
        { purpose },
      ]);
    },
  );
});
