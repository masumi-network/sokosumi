import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { defaultValidationHook, type OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthVariables } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

const { grantSupportCreditsMock } = vi.hoisted(() => ({
  grantSupportCreditsMock: vi.fn(),
}));

vi.mock("@/services/support-credit-admin.service", () => {
  class SupportCreditValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SupportCreditValidationError";
    }
  }

  return {
    SupportCreditValidationError,
    supportCreditAdminService: {
      grantSupportCredits: grantSupportCreditsMock,
    },
  };
});

const { default: mountCreateSupportCreditGrant } = await import("./post.js");

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
    c.set("requestId", "req_support_credits_test");
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
  mountCreateSupportCreditGrant(authApp);

  return app;
}

describe("admin credits routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grantSupportCreditsMock.mockResolvedValue(GRANT);
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
    expect(grantSupportCreditsMock).not.toHaveBeenCalled();
  });

  it("creates a support credit grant for an admin", async () => {
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
    expect(grantSupportCreditsMock).toHaveBeenCalledWith({
      target: { targetType: "user", targetId: "user_1" },
      credits: 500,
      ttlDays: null,
      referenceNote: "Help",
    });
  });
});
