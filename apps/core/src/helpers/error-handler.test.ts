import { z } from "@hono/zod-openapi";
import { EnterpriseContractActivationError } from "@sokosumi/database/helpers";
import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEnterpriseContractLifecycleError } from "./enterprise-contract-route";
import { serviceUnavailable } from "./error";
import { errorHandler } from "./error-handler";

const { captureExceptionMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
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

  it("includes activation blockers in 409 conflict responses", async () => {
    const app = createApp();
    app.get("/", () => {
      handleEnterpriseContractLifecycleError(
        new EnterpriseContractActivationError([
          {
            plan: "starter",
            referenceId: "org-1",
            scope: "organization",
            stripeSubscriptionId: "sub_stripe_1",
            subscriptionId: "sub_local_1",
          },
        ]),
      );
    });

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      blockers: Array<{ scope: string; subscriptionId: string }>;
      error: string;
      message: string;
    };

    expect(response.status).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.blockers).toEqual([
      {
        plan: "starter",
        referenceId: "org-1",
        scope: "organization",
        stripeSubscriptionId: "sub_stripe_1",
        subscriptionId: "sub_local_1",
      },
    ]);
    expect(captureExceptionMock).not.toHaveBeenCalled();
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
});
