import { betterAuth } from "better-auth/minimal";
import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";

import { coreEvlogMiddleware } from "@/lib/evlog";
import { coreLogEvents } from "@/test/core-log";
import { auth } from "./auth";

const { findMany, create, evalRedis, getRedisClient } = vi.hoisted(() => ({
  findMany: vi.fn(async () => []),
  create: vi.fn(async ({ data }) => data),
  evalRedis: vi.fn(),
  getRedisClient: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { rateLimit: { findMany, create } },
}));

vi.mock("@/lib/redis", () => ({ getRedisClient }));

const { handler } = betterAuth({
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
  getRedisClient.mockReturnValue({ eval: evalRedis });
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

it("works without a configured Redis client", async () => {
  getRedisClient.mockReturnValue(null);

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
