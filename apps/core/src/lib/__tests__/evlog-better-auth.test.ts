import type { DrainContext } from "evlog";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bindCoreRequestId,
  coreEvlogMiddleware,
  initCoreLogger,
} from "@/lib/evlog";

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

const captured: DrainContext[] = [];

async function loadMiddleware() {
  const { betterAuthEvlogMiddleware } = await import("@/lib/evlog-better-auth");
  return betterAuthEvlogMiddleware();
}

function createApp(identify: Awaited<ReturnType<typeof loadMiddleware>>) {
  const app = new Hono();
  app.use(requestId());
  app.use(coreEvlogMiddleware());
  app.use(bindCoreRequestId());
  app.use(identify);
  return app;
}

describe("betterAuthEvlogMiddleware", () => {
  beforeEach(() => {
    captured.length = 0;
    delete process.env.SENTRY_DSN;
    getSessionMock.mockReset();
    initCoreLogger({
      silent: true,
      drain: (ctx) => {
        captured.push(ctx);
      },
    });
  });

  it("identifies a Better Auth cookie session on the wide event", async () => {
    getSessionMock.mockResolvedValue({
      user: {
        id: "user_123",
        email: "alice@example.com",
        name: "Alice",
      },
      session: {
        id: "sess_1",
      },
    });

    const app = createApp(await loadMiddleware());
    app.get("/v1/me", (c) => c.json({ ok: true }));

    await app.request("http://localhost/v1/me");

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(captured[0]?.event.userId).toBe("user_123");
    expect(captured[0]?.event.user).toMatchObject({
      id: "user_123",
      email: "a***@example.com",
      name: "Alice",
    });
    expect(captured[0]?.event.auth).toMatchObject({
      identified: true,
    });
  });

  it("skips Better Auth session resolution on /auth routes", async () => {
    const app = createApp(await loadMiddleware());
    app.get("/auth/sign-in", (c) => c.json({ ok: true }));

    await app.request("http://localhost/auth/sign-in");

    expect(getSessionMock).not.toHaveBeenCalled();
    expect(captured[0]?.event.auth).toBeUndefined();
  });

  it("skips Better Auth session resolution on /sync cron routes", async () => {
    const app = createApp(await loadMiddleware());
    app.get("/sync/jobs", (c) => c.json({ ok: true }));

    await app.request("http://localhost/sync/jobs");

    expect(getSessionMock).not.toHaveBeenCalled();
    expect(captured[0]?.event.auth).toBeUndefined();
  });
});
