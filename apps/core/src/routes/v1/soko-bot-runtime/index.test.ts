import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { type RequestIdVariables, requestId } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";

const {
  executeToolMock,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
} = vi.hoisted(() => ({
  executeToolMock: vi.fn(),
  SokoBotRuntimeAuthorizationError: class extends Error {},
  SokoBotRuntimeConflictError: class extends Error {},
  SokoBotRuntimeValidationError: class extends Error {},
}));

vi.mock("@/services/soko-bot-runtime.service", () => ({
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
  sokoBotRuntimeService: {
    executeTool: executeToolMock,
    getContext: vi.fn(),
  },
}));

import runtimeApp from "@/routes/v1/soko-bot-runtime";

const app = new OpenAPIHono<{ Variables: RequestIdVariables }>();
app.use("*", requestId());
app.onError(errorHandler);
app.route("/", runtimeApp);

const BODY = {
  turnId: "01960001-0001-7001-8001-000000000003",
  sessionId: "session_1",
  capability: "create_task",
  toolCallId: "call_1",
  input: { name: "Launch", status: "DRAFT" },
};

function request() {
  return app.request("http://localhost/tools/execute", {
    method: "POST",
    headers: {
      authorization: "Bearer oidc-token",
      "content-type": "application/json",
      "x-soko-bot-turn-grant": "turn-grant",
    },
    body: JSON.stringify(BODY),
  });
}

describe("POST /tools/execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves expected helper rejections and marks them non-retryable", async () => {
    executeToolMock.mockRejectedValue(
      new HTTPException(403, { message: "Coworker is not available" }),
    );

    const response = await request();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Forbidden",
      kind: "tool_rejected",
      message: "Coworker is not available",
      retryable: false,
      meta: expect.objectContaining({
        method: "POST",
        path: "/tools/execute",
      }),
    });
  });

  it("does not invite retries for a previously failed tool call", async () => {
    executeToolMock.mockRejectedValue(
      new SokoBotRuntimeConflictError("Tool call previously failed"),
    );

    const response = await request();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Conflict",
      kind: "conflict",
      message: "Tool call previously failed",
      retryable: false,
      meta: expect.objectContaining({
        method: "POST",
        path: "/tools/execute",
      }),
    });
  });

  it("marks unknown failures retryable without exposing internals", async () => {
    executeToolMock.mockRejectedValue(new Error("database password"));

    const response = await request();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "InternalServerError",
      kind: "tool_execution_failed",
      message:
        "Sokosumi did not complete this operation. Do not report success; the user may retry.",
      retryable: true,
      meta: expect.objectContaining({
        method: "POST",
        path: "/tools/execute",
      }),
    });
  });

  it("rejects oversized tool requests before execution", async () => {
    const response = await app.request("http://localhost/tools/execute", {
      method: "POST",
      headers: {
        authorization: "Bearer oidc-token",
        "content-type": "application/json",
        "x-soko-bot-turn-grant": "turn-grant",
      },
      body: JSON.stringify({
        ...BODY,
        input: { payload: "x".repeat(300_000) },
      }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "PayloadTooLarge",
      kind: "payload_too_large",
      message: "Soko Bot runtime request exceeded byte limit",
      retryable: false,
      meta: expect.objectContaining({
        method: "POST",
        path: "/tools/execute",
      }),
    });
    expect(executeToolMock).not.toHaveBeenCalled();
  });
});
