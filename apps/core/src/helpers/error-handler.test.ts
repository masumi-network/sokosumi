import { z } from "@hono/zod-openapi";
import { EnterpriseContractActivationError } from "@sokosumi/database/helpers";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { APIError } from "better-auth/api";
import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEnterpriseContractLifecycleError } from "./enterprise-contract-route";
import { conflict, serviceUnavailable, upgradeRequired } from "./error";
import { errorHandler } from "./error-handler";

const { captureExceptionMock, captureExternalServiceErrorMock } = vi.hoisted(
  () => ({
    captureExceptionMock: vi.fn(),
    captureExternalServiceErrorMock: vi.fn(),
  }),
);

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/lib/external-service-errors", () => ({
  captureExternalServiceError: captureExternalServiceErrorMock,
}));

function createApp() {
  const app = new Hono<{
    Variables: RequestIdVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    await next();
  });
  app.onError(errorHandler);

  return app;
}

describe("errorHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports generic 503 HTTPExceptions to Sentry", async () => {
    const app = createApp();
    app.get("/", () => {
      throw serviceUnavailable("Storage backend unavailable");
    });

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      error: string;
      message: string;
    };

    expect(response.status).toBe(503);
    expect(body.error).toBe("ServiceUnavailable");
    expect(body.message).toBe("Storage backend unavailable");
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("does not report maintenance-mode 503 HTTPExceptions to Sentry", async () => {
    const app = createApp();
    app.get("/", () => {
      throw serviceUnavailable("Service is under maintenance", {
        kind: "maintenance-mode",
        reportToSentry: false,
      });
    });

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      error: string;
      message: string;
    };

    expect(response.status).toBe(503);
    expect(body.error).toBe("ServiceUnavailable");
    expect(body.message).toBe("Service is under maintenance");
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("returns the stable Calendar client-upgrade envelope", async () => {
    const app = createApp();
    app.get("/", () => {
      throw upgradeRequired("Reload required", {
        kind: CORE_API_ERROR_KINDS.CALENDAR_CLIENT_UPGRADE_REQUIRED,
      });
    });

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      error: string;
      kind: string;
      message: string;
    };

    expect(response.status).toBe(426);
    expect(body).toMatchObject({
      error: "UpgradeRequired",
      kind: "calendar_client_upgrade_required",
      message: "Reload required",
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("includes activation blocker in 409 conflict responses", async () => {
    const app = createApp();
    app.get("/", () => {
      handleEnterpriseContractLifecycleError(
        new EnterpriseContractActivationError({
          plan: "starter",
          referenceId: "org-1",
          scope: "organization",
          stripeSubscriptionId: "sub_stripe_1",
          subscriptionId: "sub_local_1",
        }),
      );
    });

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      blocker: { scope: string; subscriptionId: string };
      error: string;
      message: string;
    };

    expect(response.status).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body).toMatchObject({
      kind: "enterprise_activation_blocked",
    });
    expect(body.message).toBe(
      "Enterprise contract activation blocked by an active organization subscription",
    );
    expect(body.blocker).toEqual({
      plan: "starter",
      scope: "organization",
      stripeSubscriptionId: "sub_stripe_1",
      subscriptionId: "sub_local_1",
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("does not let extensions override reserved error envelope keys", async () => {
    const app = createApp();
    app.get("/", () => {
      throw conflict("Conflict", {
        kind: "test_kind",
        extensions: {
          blockers: [],
          error: "Overridden",
          message: "Overridden message",
          meta: { hijacked: true },
          kind: "shadow_kind",
        },
      });
    });

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      error: string;
      message: string;
      kind: string;
      meta: { timestamp: string; requestId: string };
      hijacked?: boolean;
    };

    expect(response.status).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toBe("Conflict");
    expect(body.kind).toBe("test_kind");
    expect(body.meta.requestId).toBe("req_123");
    expect(body.hijacked).toBeUndefined();
  });

  it("reports unhandled validation errors to Sentry as internal server errors", async () => {
    const app = createApp();
    app.get("/", () => {
      const result = z.string().safeParse(123);
      if (result.success) {
        return new Response(result.data);
      }

      throw result.error;
    });

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      error: string;
      message: string;
    };

    expect(response.status).toBe(500);
    expect(body.error).toBe("InternalServerError");
    expect(body.message).toBe("An unexpected error occurred");
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(z.ZodError),
      expect.objectContaining({
        level: "fatal",
        tags: { error_type: "unexpected_validation" },
      }),
    );
  });

  it("routes unexpected errors through captureExternalServiceError", async () => {
    const app = createApp();
    app.get("/", () => {
      throw new Error("database blew up");
    });

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      error: string;
      message: string;
    };

    expect(response.status).toBe(500);
    expect(body.error).toBe("InternalServerError");
    expect(captureExternalServiceErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        label: "unhandled_route_error",
        sentry: expect.objectContaining({
          level: "fatal",
          tags: { error_type: "unexpected" },
        }),
      }),
    );
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("maps Better Auth invalid API key APIError to 401 without Sentry", async () => {
    const app = createApp();
    app.get("/", () => {
      throw APIError.from("UNAUTHORIZED", {
        code: "INVALID_API_KEY",
        message: "Invalid API key.",
      });
    });

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      error: string;
      message: string;
    };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(body.message).toBe("Invalid API key.");
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(captureExternalServiceErrorMock).not.toHaveBeenCalled();
  });

  it("maps Better Auth short-key FORBIDDEN APIError to 403 without Sentry", async () => {
    const app = createApp();
    app.get("/", () => {
      throw APIError.from("FORBIDDEN", {
        code: "INVALID_API_KEY",
        message: "Invalid API key.",
      });
    });

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      error: string;
      message: string;
    };

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(body.message).toBe("Invalid API key.");
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(captureExternalServiceErrorMock).not.toHaveBeenCalled();
  });

  it("reports Better Auth 5xx APIError through captureExternalServiceError", async () => {
    const app = createApp();
    app.get("/", () => {
      throw APIError.from("INTERNAL_SERVER_ERROR", {
        code: "INTERNAL_SERVER_ERROR",
        message: "Auth backend failed",
      });
    });

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      error: string;
      message: string;
    };

    expect(response.status).toBe(500);
    expect(body.error).toBe("InternalServerError");
    expect(body.message).toBe("Auth backend failed");
    expect(captureExternalServiceErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        label: "better_auth_api_error",
        sentry: expect.objectContaining({
          level: "error",
          tags: { error_type: "better_auth_api_error" },
        }),
      }),
    );
  });
});
