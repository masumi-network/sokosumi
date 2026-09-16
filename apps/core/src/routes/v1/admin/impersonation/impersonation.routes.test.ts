import type { DrainContext } from "evlog";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler.js";
import { coreEvlogMiddleware, initCoreLogger } from "@/lib/evlog.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import {
  type AuthenticationContext,
  requireAdminAuthContext,
} from "@/middleware/auth";

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
  | {
      actor: "user";
      userId?: string;
      role?: string;
      impersonatedBy?: string;
      authenticationMethod?: "session" | "api_key" | "oauth";
    }
  | { actor: "coworker" };

const captured: DrainContext[] = [];

function applyAuthPreset(authContext: AuthContextPreset) {
  if (authContext.actor === "coworker") {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: "vendor_123",
    };
    return;
  }

  authContextState.current = {
    actor: "user",
    userId: authContext.userId ?? "user_admin",
    organizationId: null,
    role: authContext.role ?? "admin",
    authenticationMethod: authContext.authenticationMethod ?? "session",
    ...(authContext.impersonatedBy
      ? { impersonatedBy: authContext.impersonatedBy }
      : {}),
  };
}

function createApp(
  mountRoutes: (app: OpenAPIHonoWithAuth) => void,
  authContext: AuthContextPreset = { actor: "user" },
) {
  applyAuthPreset(authContext);

  const app = new OpenAPIHonoWithAuth();

  app.use(coreEvlogMiddleware());
  app.onError(errorHandler);
  mountRoutes(app);

  return app;
}

function createComposedApp(
  authContext: AuthContextPreset = { actor: "user" },
  impersonationFirst = true,
) {
  applyAuthPreset(authContext);

  const parent = new OpenAPIHonoWithAuth();
  parent.use(coreEvlogMiddleware());
  parent.onError(errorHandler);

  const admin = new OpenAPIHonoWithAuth();
  admin.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );
  admin.get("/users", (c) => c.json({ ok: true }));

  const impersonation = new OpenAPIHonoWithAuth();
  mountStartImpersonation(impersonation);
  mountStopImpersonation(impersonation);

  // Same order as apps/core/src/routes/v1/index.ts (impersonation before admin).
  if (impersonationFirst) {
    parent.route("/admin/impersonation", impersonation);
    parent.route("/admin", admin);
  } else {
    parent.route("/admin", admin);
    parent.route("/admin/impersonation", impersonation);
  }

  return parent;
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

  it("rejects an overlong reason", async () => {
    const app = createApp(mountBoth);
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: TARGET_USER.id, reason: "x".repeat(501) }),
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
    expect(captured[0]?.event).toMatchObject({
      audit: expect.objectContaining({
        action: "impersonation.start",
        actor: { type: "user", id: "user_admin" },
        target: { type: "user", id: TARGET_USER.id },
        outcome: "denied",
      }),
    });
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
    expect(captured[0]?.event).toMatchObject({
      audit: expect.objectContaining({
        action: "impersonation.start",
        actor: { type: "user", id: "user_plain" },
        outcome: "denied",
      }),
    });
  });

  it.each(["api_key", "oauth"] as const)(
    "rejects %s admin credentials",
    async (authenticationMethod) => {
      const app = createApp(mountBoth, {
        actor: "user",
        authenticationMethod,
      });
      const res = await app.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: TARGET_USER.id, reason: "SOK-1: x" }),
      });

      expect(res.status).toBe(403);
      expect(impersonateUserMock).not.toHaveBeenCalled();
      expect(captured[0]?.event).toMatchObject({
        audit: expect.objectContaining({
          action: "impersonation.start",
          actor: { type: "user", id: "user_admin" },
          outcome: "denied",
        }),
      });
    },
  );

  it("rejects coworker actors", async () => {
    const app = createApp(mountBoth, { actor: "coworker" });
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: TARGET_USER.id, reason: "SOK-1: x" }),
    });

    expect(res.status).toBe(403);
    expect(impersonateUserMock).not.toHaveBeenCalled();
    expect(captured[0]?.event).toMatchObject({
      audit: expect.objectContaining({
        action: "impersonation.start",
        actor: { type: "agent", id: "cow_123" },
        outcome: "denied",
      }),
    });
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
    expect(captured[0]?.event).toMatchObject({
      audit: expect.objectContaining({
        action: "impersonation.start",
        actor: { type: "user", id: "user_admin" },
        target: { type: "user", id: "user_missing" },
        outcome: "denied",
      }),
    });
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
    expect(captured[0]?.event).toMatchObject({
      audit: expect.objectContaining({
        action: "impersonation.start",
        actor: { type: "user", id: "user_admin" },
        target: { type: "user", id: "user_other_admin" },
        outcome: "denied",
      }),
    });
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
    expect(captured[0]?.event).toMatchObject({
      audit: expect.objectContaining({
        action: "impersonation.stop",
        actor: { type: "user", id: "user_plain" },
        outcome: "denied",
      }),
    });
  });

  it("rejects stop for coworker actors", async () => {
    const app = createApp(mountBoth, { actor: "coworker" });
    const res = await app.request("/", { method: "DELETE" });

    expect(res.status).toBe(403);
    expect(stopImpersonatingMock).not.toHaveBeenCalled();
    expect(captured[0]?.event).toMatchObject({
      audit: expect.objectContaining({
        action: "impersonation.stop",
        actor: { type: "agent", id: "cow_123" },
        outcome: "denied",
      }),
    });
  });
});

describe("v1 admin + impersonation mount order", () => {
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
      ),
      response: {
        session: { id: "sess_admin", userId: ADMIN_USER.id },
        user: ADMIN_USER,
      },
    });
  });

  it("lets an impersonated non-admin stop when impersonation is mounted first", async () => {
    const app = createComposedApp({
      actor: "user",
      userId: TARGET_USER.id,
      role: "user",
      impersonatedBy: "user_admin",
    });
    const res = await app.request("/admin/impersonation", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(stopImpersonatingMock).toHaveBeenCalledTimes(1);
  });

  it("returns 409 not 403 for nested start on the composed mount", async () => {
    const app = createComposedApp({
      actor: "user",
      userId: TARGET_USER.id,
      role: "user",
      impersonatedBy: "user_admin",
    });
    const res = await app.request("/admin/impersonation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user_other", reason: "SOK-1: x" }),
    });

    expect(res.status).toBe(409);
    expect(impersonateUserMock).not.toHaveBeenCalled();
  });

  it("still 403s admin child routes for a non-admin", async () => {
    const app = createComposedApp({
      actor: "user",
      userId: TARGET_USER.id,
      role: "user",
      impersonatedBy: "user_admin",
    });
    const res = await app.request("/admin/users");

    expect(res.status).toBe(403);
  });

  it("403s stop if admin is mounted first (Hono /admin/* inheritance)", async () => {
    const app = createComposedApp(
      {
        actor: "user",
        userId: TARGET_USER.id,
        role: "user",
        impersonatedBy: "user_admin",
      },
      false,
    );
    const res = await app.request("/admin/impersonation", { method: "DELETE" });

    expect(res.status).toBe(403);
    expect(stopImpersonatingMock).not.toHaveBeenCalled();
  });
});
