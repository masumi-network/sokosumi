import { z } from "@hono/zod-openapi";
import { EnterpriseContractActivationError } from "@sokosumi/database/helpers";
import { APIError } from "better-auth/api";
import { Hono } from "hono";
import { type RequestIdVariables, requestId } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { coreEvlogMiddleware } from "@/lib/evlog";
import { coreLogEvents, expectCoreLogWhys } from "@/test/core-log";
import { handleEnterpriseContractLifecycleError } from "./enterprise-contract-route";
import { conflict, serviceUnavailable, tooManyRequests } from "./error";
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

  it("writes no console line that could carry the token path on an unexpected error", async () => {
    const app = createApp();
    app.get("/v1/share/:token", () => {
      throw new Error("boom");
    });

    const response = await app.request(
      "http://localhost/v1/share/share-capability-token",
    );

    // Sentry's Console integration turns these arguments into a breadcrumb
    // on the event captured immediately after, and beforeSend only strips
    // env secrets. A concrete path here ships the capability token.
    // The handler now writes no console line at all: the error goes on the
    // request's wide event, whose path is the route template
    // (`bindCoreRequestContext`), and the console guard fails this test on
    // any console.error.
    expect(response.status).toBe(500);
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

  it("clears context.error for expected 4xx so evlog does not mark the wide event", async () => {
    const app = createApp();
    let seenError: Error | undefined = new Error("unset");
    app.use("*", async (c, next) => {
      await next();
      seenError = c.error;
    });
    app.get("/", () => {
      throw conflict("Conflict");
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(409);
    expect(seenError).toBeUndefined();
  });

  it("clears context.error for unexpected 5xx, so evlog does not log the error's text", async () => {
    const app = createApp();
    let seenError: Error | undefined = new Error("unset");
    app.use("*", async (c, next) => {
      await next();
      seenError = c.error;
    });
    app.get("/", () => {
      throw new Error("boom");
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(500);
    expect(seenError).toBeUndefined();
  });

  it("puts an unexpected error on the wide event without its text, and still reports it whole", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "A request failed with an unexpected error",
      ["The route threw an error it did not handle"],
    );
    // A Prisma validation error quotes its call's arguments: user text.
    const error = Object.assign(
      new Error(
        "Invalid `prisma.task.update()` invocation: name: 'Ada private plan'",
      ),
      { name: "PrismaClientValidationError" },
    );
    const app = new Hono();
    app.use(requestId());
    app.use(coreEvlogMiddleware());
    app.onError(errorHandler);
    app.get("/v1/fail", () => {
      throw error;
    });

    const response = await app.request("http://localhost/v1/fail");

    expect(response.status).toBe(500);
    expect(errors[0]?.cause).toBeUndefined();
    expect(errors[0]?.event).toMatchObject({
      level: "error",
      status: 500,
      failure: { errorName: "PrismaClientValidationError" },
    });
    expect(JSON.stringify(coreLogEvents())).not.toContain("Ada private plan");
    expect(captureExternalServiceErrorMock).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ label: "unhandled_route_error" }),
    );
  });

  it("puts a reported 5xx HTTPException on the wide event with its kind", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "A request failed with a server error",
      ["The route answered with an HTTP 5xx error"],
    );
    const app = new Hono();
    app.use(requestId());
    app.use(coreEvlogMiddleware());
    app.onError(errorHandler);
    app.get("/v1/fail", () => {
      throw serviceUnavailable("Storage backend unavailable", {
        kind: "storage_unavailable",
      });
    });

    const response = await app.request("http://localhost/v1/fail");

    expect(response.status).toBe(503);
    expect(errors[0]?.event).toMatchObject({
      kind: "storage_unavailable",
      failure: { status: 503 },
    });
  });

  it("sets Retry-After header and body delay for throttled errors", async () => {
    const app = createApp();
    app.get("/", () => {
      throw tooManyRequests("Slow down", {
        kind: "message_read_budget_exceeded",
        retryAfterSeconds: 7,
      });
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("7");
    const body = await response.json();
    expect(body.kind).toBe("message_read_budget_exceeded");
    expect(body.retryAfterSeconds).toBe(7);
  });

  it("omits Retry-After when no retry delay is set", async () => {
    const app = createApp();
    app.get("/", () => {
      throw tooManyRequests("Slow down");
    });

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeNull();
    const body = await response.json();
    expect(body.retryAfterSeconds).toBeUndefined();
  });
});
