import { betterAuth } from "better-auth/minimal";
import type { DrainContext } from "evlog";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bindCoreRequestContext,
  coreEvlogMiddleware,
  initCoreLogger,
} from "@/lib/evlog";
import { betterAuthLogger } from "@/lib/evlog-library-logs";

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
  app.use(bindCoreRequestContext());
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
    expect(captured[0]?.event.user).toEqual({
      id: "user_123",
      email: "a***@example.com",
    });
    expect(captured[0]?.event.session).toBeUndefined();
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

  it("emits an info event when Better Auth throws an OAuth error-page redirect", async () => {
    const auth = betterAuth({
      baseURL: "http://localhost",
      basePath: "/auth",
      secret: "test-secret-that-is-long-enough-for-better-auth",
      logger: betterAuthLogger,
      onAPIError: { errorURL: "http://localhost/sign-in-error" },
      rateLimit: { enabled: false },
    });
    const app = createApp(await loadMiddleware());
    app.get("/auth/*", (c) => auth.handler(c.req.raw));

    const response = await app.request("http://localhost/auth/callback/google");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://localhost/sign-in-error?error=state_not_found",
    );
    expect(captured.map(({ event }) => event)).toMatchObject([
      {
        status: 302,
        level: "info",
        libraryLogs: [
          { source: "better-auth", level: "info", message: "State not found" },
        ],
      },
    ]);
    expect(captured[0]?.event).not.toHaveProperty("error");
  });

  it.each([401, 500] as const)(
    "keeps Better Auth library errors at error for HTTP %i",
    async (status) => {
      const app = createApp(await loadMiddleware());
      app.get("/auth/check", (c) => {
        betterAuthLogger.log("error", "Auth request failed");
        return c.body(null, status);
      });

      const response = await app.request("/auth/check");

      expect(response.status).toBe(status);
      expect(captured.map(({ event }) => event)).toMatchObject([
        { status, level: "error", error: { message: "Auth request failed" } },
      ]);
    },
  );

  it("skips cookie identify when an Authorization header is present", async () => {
    getSessionMock.mockResolvedValue({
      user: {
        id: "user_cookie",
        email: "alice@example.com",
        name: "Alice",
      },
      session: {
        id: "sess_cookie",
      },
    });

    const app = createApp(await loadMiddleware());
    app.get("/v1/me", (c) => c.json({ ok: true }));

    await app.request("http://localhost/v1/me", {
      headers: { authorization: "Bearer coworker_key" },
    });

    expect(getSessionMock).not.toHaveBeenCalled();
    expect(captured[0]?.event.userId).toBeUndefined();
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
