import type { DrainContext } from "evlog";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import {
  attachAuthToLogger,
  attachWorkspaceToLogger,
  bindCoreRequestId,
  coreEvlogMiddleware,
  identifyBetterAuthSession,
  initCoreLogger,
} from "@/lib/evlog";
import type { AuthVariables } from "@/middleware/auth";
import { setAuthContext } from "@/middleware/auth";

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  getCurrentScope: () => ({
    setUser: vi.fn(),
    setContext: vi.fn(),
  }),
}));

vi.mock("@/lib/external-service-errors", () => ({
  captureExternalServiceError: vi.fn(),
}));

const captured: DrainContext[] = [];

function createApp() {
  const app = new Hono<{
    Variables: RequestIdVariables & AuthVariables;
  }>();
  app.use(requestId());
  app.use(coreEvlogMiddleware());
  app.use(bindCoreRequestId());
  return app;
}

describe("core evlog request events", () => {
  beforeEach(() => {
    captured.length = 0;
    initCoreLogger({
      silent: true,
      drain: (ctx) => {
        captured.push(ctx);
      },
    });
  });

  it("emits one wide event with method, path, status, and Core requestId", async () => {
    const app = createApp();
    app.get("/v1/jobs", (c) =>
      c.json({
        data: { jobs: [] },
        meta: { requestId: c.var.requestId },
      }),
    );
    const response = await app.request("http://localhost/v1/jobs");
    const body = (await response.json()) as {
      meta: { requestId: string };
    };

    expect(response.status).toBe(200);
    expect(captured).toHaveLength(1);

    const ctx = captured[0];
    expect(ctx?.request?.method).toBe("GET");
    expect(ctx?.request?.path).toBe("/v1/jobs");
    expect(ctx?.event.status).toBe(200);
    expect(ctx?.event.requestId).toBe(body.meta.requestId);
    expect(body.meta.requestId).toEqual(expect.any(String));
  });

  it("does not emit a wide event for the OpenAPI snapshot", async () => {
    const app = createApp();
    app.get("/v1/openapi.json", (c) => c.json({ openapi: "3.1.0" }));
    const response = await app.request("http://localhost/v1/openapi.json");

    expect(response.status).toBe(200);
    expect(captured).toHaveLength(0);
  });

  it("adds actor, user, organization, and workspace ids on authenticated requests", async () => {
    const app = createApp();
    app.use(async (_c, next) => {
      attachAuthToLogger({
        actor: "user",
        userId: "user_123",
        organizationId: "org_456",
      });
      attachWorkspaceToLogger({
        workspaceId: "ws_789",
        userId: "user_123",
        organizationId: "org_456",
      });
      return await next();
    });
    app.get("/v1/tasks", (c) =>
      c.json({ meta: { requestId: c.var.requestId } }),
    );

    const response = await app.request("http://localhost/v1/tasks");

    expect(response.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.event.actor).toBe("user");
    expect(captured[0]?.event.user).toEqual({ id: "user_123" });
    expect(captured[0]?.event.organization).toEqual({ id: "org_456" });
    expect(captured[0]?.event.workspace).toEqual({
      id: "ws_789",
      userId: "user_123",
      organizationId: "org_456",
    });
  });

  it("setAuthContext copies the authenticated user onto the wide event", async () => {
    const app = createApp();
    app.use(async (c, next) => {
      setAuthContext(c as never, {
        isAuthenticated: true,
        authContext: {
          actor: "user",
          userId: "user_123",
          organizationId: "org_456",
          role: "user",
        },
      });
      return await next();
    });
    app.get("/v1/me", (c) => c.json({ ok: true }));

    await app.request("http://localhost/v1/me");

    expect(captured[0]?.event.actor).toBe("user");
    expect(captured[0]?.event.user).toEqual({ id: "user_123" });
    expect(captured[0]?.event.organization).toEqual({ id: "org_456" });
  });

  it("identifies a Better Auth session with a masked email", async () => {
    const app = createApp();
    app.use(async (_c, next) => {
      identifyBetterAuthSession({
        user: {
          id: "user_123",
          email: "alice@example.com",
          name: "Alice",
        },
        session: {
          id: "sess_1",
        },
      });
      return await next();
    });
    app.get("/v1/me", (c) => c.json({ ok: true }));

    await app.request("http://localhost/v1/me");

    expect(captured[0]?.event.userId).toBe("user_123");
    expect(captured[0]?.event.user).toMatchObject({
      id: "user_123",
      email: "a***@example.com",
      name: "Alice",
    });
    expect(captured[0]?.event.session).toMatchObject({ id: "sess_1" });
  });

  it("records a thrown HTTPException on the wide event", async () => {
    const app = createApp();
    app.onError(errorHandler);
    app.get("/v1/fail", () => {
      throw new HTTPException(409, { message: "Conflict" });
    });

    const response = await app.request("http://localhost/v1/fail");

    expect(response.status).toBe(409);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.event.status).toBe(409);
    expect(captured[0]?.event.level).toBe("error");
  });
});
