import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticationContext, AuthVariables } from "./auth";
import { sentryMiddleware } from "./sentry";

const {
  getActiveSpanMock,
  getCurrentScopeMock,
  setAttributeMock,
  setContextMock,
  setUserMock,
  startSpanMock,
} = vi.hoisted(() => ({
  getActiveSpanMock: vi.fn(),
  getCurrentScopeMock: vi.fn(),
  setAttributeMock: vi.fn(),
  setContextMock: vi.fn(),
  setUserMock: vi.fn(),
  startSpanMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  getActiveSpan: getActiveSpanMock,
  getCurrentScope: getCurrentScopeMock,
  startSpan: startSpanMock,
}));

function createApp(params: {
  authContext?: AuthenticationContext;
  isAuthenticated?: boolean;
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
  app.get("/", (c) => c.text("ok"));

  return app;
}

describe("sentryMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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

  it("maps authenticated user actor to sentry user", async () => {
    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      },
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(setUserMock).toHaveBeenCalledTimes(1);
    expect(setUserMock).toHaveBeenCalledWith({
      id: "user_123",
      organizationId: "org_123",
    });
  });

  it("maps authenticated coworker actor to namespaced sentry user", async () => {
    const app = createApp({
      isAuthenticated: true,
      authContext: {
        actor: "coworker",
        coworkerId: "cow_123",
      },
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(setUserMock).toHaveBeenCalledTimes(1);
    expect(setUserMock).toHaveBeenCalledWith({
      id: "coworker:cow_123",
      coworkerId: "cow_123",
    });
  });

  it("does not set sentry user when request is unauthenticated", async () => {
    const app = createApp({
      isAuthenticated: false,
      authContext: {
        actor: "user",
        userId: "user_123",
        organizationId: null,
      },
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(setUserMock).not.toHaveBeenCalled();
  });

  it("does not set sentry user when auth context is missing", async () => {
    const app = createApp({
      isAuthenticated: true,
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(setUserMock).not.toHaveBeenCalled();
  });
});
