import { z } from "@hono/zod-openapi";
import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it.each(["Service is under maintenance", "Storage backend unavailable"])(
    "reports thrown 503 HTTPExceptions to Sentry (%s)",
    async (message) => {
      const app = createApp();
      app.get("/", () => {
        throw serviceUnavailable(message);
      });

      const response = await app.request("http://localhost/");
      const body = (await response.json()) as {
        error: string;
        message: string;
      };

      expect(response.status).toBe(503);
      expect(body.error).toBe("ServiceUnavailable");
      expect(body.message).toBe(message);
      expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    },
  );

  it("does not report validation errors to Sentry", async () => {
    const app = createApp();
    app.get("/", () => {
      z.string().parse(123);
    });

    const response = await app.request("http://localhost/");
    const body = (await response.json()) as {
      error: string;
      message: string;
    };

    expect(response.status).toBe(422);
    expect(body.error).toBe("UnprocessableEntity");
    expect(body.message).toBe("Invalid input: expected string, received number");
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
