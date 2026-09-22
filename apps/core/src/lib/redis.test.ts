import { beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock, redisCtor } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  redisCtor: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("ioredis", () => ({
  default: class Redis {
    constructor(url: string) {
      redisCtor(url);
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
});
