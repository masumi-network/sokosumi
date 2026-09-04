import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureExceptionMock, getSokoBotAvailabilityMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  getSokoBotAvailabilityMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/lib/external-service-errors", () => ({
  captureExternalServiceError: vi.fn(),
}));

vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: getSokoBotAvailabilityMock,
  setSokoBotDisabled: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

import { errorHandler } from "@/helpers/error-handler";

import app from "./index";

function createApp() {
  const parent = new Hono<{
    Variables: RequestIdVariables;
  }>();
  parent.use("*", async (c, next) => {
    c.set("requestId", "req_kill_switch");
    await next();
  });
  parent.onError(errorHandler);
  parent.route("/", app);
  return parent;
}

describe("Soko Bot administrator kill switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSokoBotAvailabilityMock.mockResolvedValue({
      disabled: true,
      disabledAt: new Date("2026-08-28T22:21:00.000Z"),
      disabledReason: "operator disabled for test",
    });
  });

  it("returns 503 on GET /me/turns without reporting to Sentry", async () => {
    const response = await createApp().request(
      "http://localhost/me/turns?limit=20",
    );
    const body = (await response.json()) as {
      error: string;
      kind?: string;
      message: string;
    };

    expect(response.status).toBe(503);
    expect(body.error).toBe("ServiceUnavailable");
    expect(body.message).toBe("operator disabled for test");
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(body.kind).toBe("soko-bot-disabled");
  });
});
