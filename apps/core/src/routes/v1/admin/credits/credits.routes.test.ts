import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const { grantFreeCreditsMock } = vi.hoisted(() => ({
  grantFreeCreditsMock: vi.fn(),
}));

vi.mock("@/services/free-credit-admin.service", () => {
  class FreeCreditValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "FreeCreditValidationError";
    }
  }

  return {
    FreeCreditValidationError,
    freeCreditAdminService: {
      grantFreeCredits: grantFreeCreditsMock,
    },
  };
});

const { default: mountCreateFreeCreditGrant } = await import("./post.js");
const { FreeCreditValidationError } = await import(
  "@/services/free-credit-admin.service.js"
);

const GRANT = {
  bucketId: "bucket_1",
  targetType: "user",
  targetId: "user_1",
  targetName: "Ada",
  credits: 500,
  ttlDays: null,
  referenceNote: "Help",
} as const;

interface AppOptions {
  role?: string;
}

function createApp(options: AppOptions = {}) {
  const { role = "admin" } = options;
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_free_credits_test");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role,
    });

    await next();
  });

  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );

  app.onError(errorHandler);
  const authApp = app as unknown as OpenAPIHonoWithAuth;
  mountCreateFreeCreditGrant(authApp);

  return app;
}

describe("admin credits routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grantFreeCreditsMock.mockResolvedValue(GRANT);
  });

  it("returns 403 for non-admin users", async () => {
    const app = createApp({ role: "member" });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "user",
        targetId: "user_1",
        credits: 500,
        ttlDays: null,
        referenceNote: null,
      }),
    });

    expect(response.status).toBe(403);
    expect(grantFreeCreditsMock).not.toHaveBeenCalled();
  });

  it("creates a free credit grant for an admin", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "user",
        targetId: "user_1",
        credits: 500,
        ttlDays: null,
        referenceNote: "Help",
      }),
    });

    expect(response.status).toBe(200);
    expect(grantFreeCreditsMock).toHaveBeenCalledWith({
      target: { targetType: "user", targetId: "user_1" },
      credits: 500,
      ttlDays: null,
      referenceNote: "Help",
    });
  });

  it("carries the free_credit_invalid kind on validation failures", async () => {
    grantFreeCreditsMock.mockRejectedValue(
      new FreeCreditValidationError("User not found"),
    );
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "user",
        targetId: "user_missing",
        credits: 500,
        ttlDays: null,
        referenceNote: null,
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.kind).toBe("free_credit_invalid");
    expect(body.message).toBe("User not found");
  });

  it("returns 400 for invalid request bodies without calling the service", async () => {
    const app = createApp();

    const zeroCreditsResponse = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "user",
        targetId: "user_1",
        credits: 0,
        ttlDays: null,
        referenceNote: null,
      }),
    });

    expect(zeroCreditsResponse.status).toBe(422);
    expect(grantFreeCreditsMock).not.toHaveBeenCalled();

    const excessiveTtlResponse = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "user",
        targetId: "user_1",
        credits: 500,
        ttlDays: 3651,
        referenceNote: null,
      }),
    });

    expect(excessiveTtlResponse.status).toBe(422);
    expect(grantFreeCreditsMock).not.toHaveBeenCalled();
  });
});
