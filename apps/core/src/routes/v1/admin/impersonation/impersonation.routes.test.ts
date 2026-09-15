import type { DrainContext } from "evlog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler.js";
import { coreEvlogMiddleware, initCoreLogger } from "@/lib/evlog.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthenticationContext } from "@/middleware/auth";

const {
  authContextState,
  impersonateUserMock,
  stopImpersonatingMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
  impersonateUserMock: vi.fn(),
  stopImpersonatingMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      impersonateUser: impersonateUserMock,
      stopImpersonating: stopImpersonatingMock,
    },
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: userFindUniqueMock } },
}));

const { default: mountStartImpersonation } = await import("./post.js");
const { default: mountStopImpersonation } = await import("./delete.js");

type AuthContextPreset =
  | { actor: "user"; userId?: string; role?: string; impersonatedBy?: string }
  | { actor: "coworker" };

const captured: DrainContext[] = [];

function createApp(
  mountRoutes: (app: OpenAPIHonoWithAuth) => void,
  authContext: AuthContextPreset = { actor: "user" },
) {
  if (authContext.actor === "coworker") {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "vendor_123",
    };
  } else {
    authContextState.current = {
      actor: "user",
      userId: authContext.userId ?? "user_admin",
      organizationId: null,
      role: authContext.role ?? "admin",
      ...(authContext.impersonatedBy
        ? { impersonatedBy: authContext.impersonatedBy }
        : {}),
    };
  }

  const app = new OpenAPIHonoWithAuth();

  app.use(coreEvlogMiddleware());
  app.onError(errorHandler);
  mountRoutes(app);

  return app;
}

function mountBoth(app: OpenAPIHonoWithAuth) {
  mountStartImpersonation(app);
  mountStopImpersonation(app);
}

function headersWithCookies(...cookies: string[]): Headers {
  const headers = new Headers();
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return headers;
}

const TARGET_USER = {
  id: "user_target",
  name: "Target User",
  email: "target@example.com",
  role: "user",
};

describe("POST /v1/admin/impersonation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.length = 0;
    delete process.env.SENTRY_DSN;
    initCoreLogger({
      silent: true,
      drain: (ctx) => {
        captured.push(ctx);
      },
    });

    userFindUniqueMock.mockResolvedValue(TARGET_USER);
    impersonateUserMock.mockResolvedValue({
      headers: headersWithCookies(
        "session_token=impersonated; Path=/; HttpOnly",
        "admin_session=admin; Path=/; HttpOnly",
      ),
      response: {
        session: { id: "sess_impersonated", userId: TARGET_USER.id },
        user: TARGET_USER,
      },
    });
  });

  it("starts an impersonation and forwards the session cookies", async () => {
    const app = createApp(mountBoth);
    const res = await app.request("/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "session_token=admin",
      },
      body: JSON.stringify({
        userId: TARGET_USER.id,
        reason: "SOK-1080: reproduce reported bug",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toEqual({
      id: TARGET_USER.id,
      name: TARGET_USER.name,
      email: TARGET_USER.email,
    });

    expect(impersonateUserMock).toHaveBeenCalledTimes(1);
    const call = impersonateUserMock.mock.calls[0]?.[0] as {
      body: unknown;
      headers: Headers;
    };
    expect(call.body).toEqual({ userId: TARGET_USER.id });
    expect(call.headers).toBeInstanceOf(Headers);
    expect(call.headers.get("cookie")).toBe("session_token=admin");

    expect(res.headers.getSetCookie()).toEqual([
      "session_token=impersonated; Path=/; HttpOnly",
      "admin_session=admin; Path=/; HttpOnly",
    ]);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.event).toMatchObject({
      audit: expect.objectContaining({
        action: "impersonation.start",
        actor: { type: "user", id: "user_admin" },
        target: { type: "user", id: TARGET_USER.id },
        reason: "SOK-1080: reproduce reported bug",
        outcome: "success",
      }),
    });
  });

  it("rejects a start without a reason", async () => {
    const app = createApp(mountBoth);
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: TARGET_USER.id }),
    });

    expect(res.status).toBe(422);
    expect(impersonateUserMock).not.toHaveBeenCalled();
    expect(captured[0]?.event).not.toHaveProperty("audit");
  });

  it("rejects a blank reason", async () => {
    const app = createApp(mountBoth);
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: TARGET_USER.id, reason: "   " }),
    });

    expect(res.status).toBe(422);
    expect(impersonateUserMock).not.toHaveBeenCalled();
  });

  it("rejects a second impersonation while one is active", async () => {
    const app = createApp(mountBoth, {
      actor: "user",
      userId: TARGET_USER.id,
      role: "user",
      impersonatedBy: "user_admin",
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user_other", reason: "SOK-1: x" }),
    });

    expect(res.status).toBe(409);
    expect(impersonateUserMock).not.toHaveBeenCalled();
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin callers", async () => {
    const app = createApp(mountBoth, {
      actor: "user",
      userId: "user_plain",
      role: "user",
    });
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: TARGET_USER.id, reason: "SOK-1: x" }),
    });

    expect(res.status).toBe(403);
    expect(impersonateUserMock).not.toHaveBeenCalled();
  });

  it("rejects coworker actors", async () => {
    const app = createApp(mountBoth, { actor: "coworker" });
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: TARGET_USER.id, reason: "SOK-1: x" }),
    });

    expect(res.status).toBe(403);
    expect(impersonateUserMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the target user does not exist", async () => {
    userFindUniqueMock.mockResolvedValue(null);

    const app = createApp(mountBoth);
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user_missing", reason: "SOK-1: x" }),
    });

    expect(res.status).toBe(404);
    expect(impersonateUserMock).not.toHaveBeenCalled();
    expect(captured[0]?.event).not.toHaveProperty("audit");
  });

  it("rejects admin users as targets", async () => {
    userFindUniqueMock.mockResolvedValue({
      ...TARGET_USER,
      id: "user_other_admin",
      role: "admin",
    });

    const app = createApp(mountBoth);
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user_other_admin", reason: "SOK-1: x" }),
    });

    expect(res.status).toBe(403);
    expect(impersonateUserMock).not.toHaveBeenCalled();
    expect(captured[0]?.event).not.toHaveProperty("audit");
  });

  it("fails loudly when no session cookie comes back", async () => {
    impersonateUserMock.mockResolvedValue({
      headers: new Headers(),
      response: { session: null, user: TARGET_USER },
    });

    const app = createApp(mountBoth);
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: TARGET_USER.id, reason: "SOK-1: x" }),
    });

    expect(res.status).toBe(500);
    expect(captured[0]?.event).not.toHaveProperty("audit");
  });
});

describe("DELETE /v1/admin/impersonation", () => {
  const ADMIN_USER = {
    id: "user_admin",
    name: "Admin User",
    email: "admin@example.com",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    captured.length = 0;
    delete process.env.SENTRY_DSN;
    initCoreLogger({
      silent: true,
      drain: (ctx) => {
        captured.push(ctx);
      },
    });

    stopImpersonatingMock.mockResolvedValue({
      headers: headersWithCookies(
        "session_token=admin-restored; Path=/; HttpOnly",
        "admin_session=; Path=/; Max-Age=0",
      ),
      response: {
        session: { id: "sess_admin", userId: ADMIN_USER.id },
        user: ADMIN_USER,
      },
    });
  });

  it("stops an active impersonation and restores the admin session", async () => {
    const app = createApp(mountBoth, {
      actor: "user",
      userId: TARGET_USER.id,
      role: "user",
      impersonatedBy: "user_admin",
    });
    const res = await app.request("/", {
      method: "DELETE",
      headers: { cookie: "session_token=impersonated" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(ADMIN_USER);

    expect(stopImpersonatingMock).toHaveBeenCalledTimes(1);
    const call = stopImpersonatingMock.mock.calls[0]?.[0] as {
      headers: Headers;
    };
    expect(call.headers).toBeInstanceOf(Headers);
    expect(call.headers.get("cookie")).toBe("session_token=impersonated");

    expect(res.headers.getSetCookie()).toEqual([
      "session_token=admin-restored; Path=/; HttpOnly",
      "admin_session=; Path=/; Max-Age=0",
    ]);

    expect(captured).toHaveLength(1);
    expect(captured[0]?.event).toMatchObject({
      audit: expect.objectContaining({
        action: "impersonation.stop",
        actor: { type: "user", id: "user_admin" },
        target: { type: "user", id: TARGET_USER.id },
        outcome: "success",
      }),
    });
  });

  it("rejects a stop when not impersonating", async () => {
    const app = createApp(mountBoth, {
      actor: "user",
      userId: "user_plain",
      role: "user",
    });
    const res = await app.request("/", { method: "DELETE" });

    expect(res.status).toBe(400);
    expect(stopImpersonatingMock).not.toHaveBeenCalled();
    expect(captured[0]?.event).not.toHaveProperty("audit");
  });

  it("rejects stop for coworker actors", async () => {
    const app = createApp(mountBoth, { actor: "coworker" });
    const res = await app.request("/", { method: "DELETE" });

    expect(res.status).toBe(403);
    expect(stopImpersonatingMock).not.toHaveBeenCalled();
  });
});
