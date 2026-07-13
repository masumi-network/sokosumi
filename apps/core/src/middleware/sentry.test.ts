import * as Sentry from "@sentry/node";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import type { AuthenticationContext, AuthVariables } from "./auth";
import { setAuthContext } from "./auth";
import { sentryMiddleware } from "./sentry";

const {
  getActiveSpanMock,
  captureExceptionMock,
  getCurrentScopeMock,
  setAttributeMock,
  setContextMock,
  setUserMock,
  startSpanMock,
  withIsolationScopeMock,
} = vi.hoisted(() => ({
  getActiveSpanMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  getCurrentScopeMock: vi.fn(),
  setAttributeMock: vi.fn(),
  setContextMock: vi.fn(),
  setUserMock: vi.fn(),
  startSpanMock: vi.fn(),
  withIsolationScopeMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
  getActiveSpan: getActiveSpanMock,
  getCurrentScope: getCurrentScopeMock,
  startSpan: startSpanMock,
  withIsolationScope: withIsolationScopeMock,
}));

function createApp(params: {
  authContext?: AuthenticationContext;
  isAuthenticated?: boolean;
  nestedAuthContext?: AuthenticationContext;
  nestedIsAuthenticated?: boolean;
}) {
  const app = new Hono<{
    Variables: { requestId: string } & Partial<AuthVariables>;
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");

    if (params.isAuthenticated !== undefined) {
      c.set("isAuthenticated", params.isAuthenticated);
    }

    if (params.authContext) {
      c.set("authContext", params.authContext);
    }

    return await next();
  });

  app.use("*", sentryMiddleware());
  app.use("*", async (c, next) => {
    if (params.nestedIsAuthenticated !== undefined) {
      if (params.nestedAuthContext) {
        setAuthContext(c as never, {
          isAuthenticated: params.nestedIsAuthenticated,
          authContext: params.nestedAuthContext,
        });
      } else {
        c.set("isAuthenticated", params.nestedIsAuthenticated);
      }
    }

    if (
      params.nestedAuthContext &&
      params.nestedIsAuthenticated === undefined
    ) {
      c.set("authContext", params.nestedAuthContext);
    }

    return await next();
  });
  app.get("/", (c) => c.text("ok"));

  return app;
}

describe("sentryMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    withIsolationScopeMock.mockImplementation(async (callback) => {
      return await callback();
    });
    startSpanMock.mockImplementation(async (_spanConfig, callback) => {
      return await callback();
    });
    getCurrentScopeMock.mockReturnValue({
      setContext: setContextMock,
      setUser: setUserMock,
    });
    getActiveSpanMock.mockReturnValue({
      setAttribute: setAttributeMock,
    });
  });

  it("maps authenticated user actor to sentry user when auth is set after sentry middleware", async () => {
    const app = createApp({
      nestedIsAuthenticated: true,
      nestedAuthContext: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
        role: "user",
      },
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(withIsolationScopeMock).toHaveBeenCalledTimes(1);
    expect(setUserMock).toHaveBeenNthCalledWith(1, null);
    expect(setUserMock).toHaveBeenCalledTimes(2);
    expect(setUserMock).toHaveBeenNthCalledWith(2, {
      id: "user_123",
      organizationId: "org_123",
    });
  });

  it("maps authenticated coworker actor to namespaced sentry user when auth is set after sentry middleware", async () => {
    const app = createApp({
      nestedIsAuthenticated: true,
      nestedAuthContext: {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
      },
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(setUserMock).toHaveBeenNthCalledWith(1, null);
    expect(setUserMock).toHaveBeenCalledTimes(2);
    expect(setUserMock).toHaveBeenNthCalledWith(2, {
      id: "coworker:cow_123",
      coworkerId: "cow_123",
    });
  });

  it("sets sentry user before downstream exception capture", async () => {
    const app = new Hono<{
      Variables: { requestId: string } & Partial<AuthVariables>;
    }>();

    app.use("*", async (c, next) => {
      c.set("requestId", "req_123");
      return await next();
    });
    app.use("*", sentryMiddleware());
    app.use("*", async (c, next) => {
      setAuthContext(c as never, {
        isAuthenticated: true,
        authContext: {
          actor: "user",
          userId: "user_123",
          organizationId: "org_123",
          role: "user",
        },
      });

      return await next();
    });
    app.get("/", () => {
      expect(setUserMock).toHaveBeenNthCalledWith(1, null);
      expect(setUserMock).toHaveBeenNthCalledWith(2, {
        id: "user_123",
        organizationId: "org_123",
      });
      Sentry.captureException(new Error("route failure"));
      return new Response("ok");
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("does not set sentry user when request is unauthenticated", async () => {
    const app = createApp({
      isAuthenticated: false,
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "user",
      },
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(setUserMock).toHaveBeenCalledTimes(1);
    expect(setUserMock).toHaveBeenCalledWith(null);
  });

  it("does not set sentry user when auth context is missing", async () => {
    const app = createApp({
      isAuthenticated: true,
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(setUserMock).toHaveBeenCalledTimes(1);
    expect(setUserMock).toHaveBeenCalledWith(null);
  });

  it("clears the request scope before auth runs so prior user state cannot leak", async () => {
    const app = new Hono<{
      Variables: { requestId: string } & Partial<AuthVariables>;
    }>();

    app.use("*", async (c, next) => {
      c.set("requestId", "req_123");
      return await next();
    });
    app.use("*", sentryMiddleware());
    app.get("/", () => {
      Sentry.captureException(new Error("unauthenticated failure"));
      return new Response("ok");
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(setUserMock).toHaveBeenCalledTimes(1);
    expect(setUserMock).toHaveBeenCalledWith(null);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("redacts sensitive request headers before sending them to sentry", async () => {
    const app = createApp({});

    const response = await app.request("http://localhost/", {
      headers: {
        authorization: "Bearer secret-token",
        cookie: "session=top-secret",
        "x-api-key": "raw-api-key",
        "x-request-source": "test-suite",
      },
    });

    expect(response.status).toBe(200);
    expect(setContextMock).toHaveBeenCalledWith(
      "request",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "[REDACTED]",
          cookie: "[REDACTED]",
          "x-api-key": "[REDACTED]",
          "x-request-source": "test-suite",
        }),
      }),
    );
  });
});
