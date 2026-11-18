import { strict as assert } from "node:assert";
import { once } from "node:events";
import { createServer } from "node:net";
import { betterAuth } from "better-auth/minimal";
import { Hono } from "hono";
import Redis from "ioredis";
import { beforeEach, expect, it, vi } from "vitest";

import { coreEvlogMiddleware } from "@/lib/evlog";
import { coreLogEvents } from "@/test/core-log";
import { auth } from "./auth";

const { findMany, create, evalRedis, getRedisRateLimitClient } = vi.hoisted(
  () => ({
    findMany: vi.fn(async () => []),
    create: vi.fn(async ({ data }) => data),
    evalRedis: vi.fn(),
    getRedisRateLimitClient: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: { rateLimit: { findMany, create } },
}));

vi.mock("@/lib/redis", () => ({ getRedisRateLimitClient }));

const { handler, $context } = betterAuth({
  ...auth.options,
  rateLimit: { ...auth.options.rateLimit, enabled: true },
});
const app = new Hono();
app.use(coreEvlogMiddleware());
app.all("/auth/*", (c) => handler(c.req.raw));

function request(path: string, init?: RequestInit) {
  return app.request(`https://example.com/auth${path}`, {
    ...init,
    headers: {
      "x-vercel-forwarded-for": "192.0.2.1",
      ...init?.headers,
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  evalRedis.mockResolvedValue(1);
  getRedisRateLimitClient.mockReturnValue({ status: "ready", eval: evalRedis });
});

it("serves an auth request without querying the Prisma rate-limit table", async () => {
  expect((await request("/ok")).status).toBe(200);
  expect(findMany).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(evalRedis).toHaveBeenCalledOnce();
});

it("throttles email OTP sends after ten requests in its 60-second window", async () => {
  const path = "/email-otp/send-verification-otp";
  evalRedis.mockResolvedValueOnce(10).mockResolvedValueOnce(11);
  const post = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  };

  expect((await request(path, post)).status).toBe(400);
  const limited = await request(path, post);
  expect(limited.status).toBe(429);
  expect(limited.headers.get("X-Retry-After")).toBe("60");
  expect(evalRedis).toHaveBeenCalledTimes(2);
  expect(evalRedis).toHaveBeenLastCalledWith(
    expect.stringContaining('redis.call("expire", KEYS[1], ARGV[1])'),
    1,
    expect.stringMatching(
      /^auth:rate-limit:.+:192\.0\.2\.1\|\/email-otp\/send-verification-otp$/,
    ),
    60,
  );
  expect(findMany).not.toHaveBeenCalled();
});

it("fails open and records a single request event when Redis rejects", async () => {
  evalRedis.mockRejectedValueOnce(new Error("Redis unavailable"));

  expect((await request("/ok")).status).toBe(200);
  expect(findMany).not.toHaveBeenCalled();
  expect(coreLogEvents()).toMatchObject([
    { level: "info", rateLimit: { failOpen: true, cause: "Error" } },
  ]);
});

it("answers with fail-open before Redis reports a refused connection", async () => {
  await $context;
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await server[Symbol.asyncDispose]();
  assert(address && typeof address !== "string");

  const redis = new Redis(address.port, address.address);
  const refused = once(redis, "error").then(([error]) => error);
  redis.once("error", () => redis.disconnect());
  getRedisRateLimitClient.mockReturnValue(redis);

  const response = request("/ok");
  try {
    const first = await Promise.race([response, refused.then(() => null)]);
    expect(await refused).toMatchObject({ code: "ECONNREFUSED" });
    expect(first?.status).toBe(200);
    expect(coreLogEvents()).toMatchObject([
      {
        level: "info",
        rateLimit: { failOpen: true, cause: "redis_not_ready" },
      },
    ]);
  } finally {
    redis.disconnect();
    await response;
  }
});

it("works without a configured Redis client", async () => {
  getRedisRateLimitClient.mockReturnValue(null);

  expect((await request("/ok")).status).toBe(200);
  expect(findMany).not.toHaveBeenCalled();
  expect(evalRedis).not.toHaveBeenCalled();
  expect(coreLogEvents()).toMatchObject([
    {
      level: "info",
      rateLimit: { failOpen: true, cause: "redis_not_configured" },
    },
  ]);
});
