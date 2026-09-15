import { describe, expect, it } from "vitest";

import {
  CoreApiRequestError,
  executeCoreOperation,
  executeCoreOperationWithResponse,
} from "@/lib/clients/core.request";
import { CORE_REQUEST_ID_HEADER } from "@/lib/clients/utils/core-request-id";

describe("executeCoreOperation", () => {
  it("copies Core's request id from the error envelope", async () => {
    await expect(
      executeCoreOperation(
        async () => ({}) as never,
        async () => ({
          error: {
            error: "NotFound",
            message: "missing",
            meta: { requestId: "req_from_core" },
          },
          response: new Response(null, { status: 404 }),
        }),
        "fallback",
      ),
    ).rejects.toMatchObject({
      requestId: "req_from_core",
      status: 404,
    });
  });

  it("prefers the X-Request-Id response header", async () => {
    await expect(
      executeCoreOperation(
        async () => ({}) as never,
        async () => ({
          error: {
            error: "NotFound",
            message: "missing",
            meta: { requestId: "req_from_body" },
          },
          response: new Response(null, {
            status: 404,
            headers: { [CORE_REQUEST_ID_HEADER]: "req_from_header" },
          }),
        }),
        "fallback",
      ),
    ).rejects.toMatchObject({
      requestId: "req_from_header",
    });
  });

  it("carries the retry delay from a throttled error", async () => {
    await expect(
      executeCoreOperation(
        async () => ({}) as never,
        async () => ({
          error: {
            error: "TooManyRequests",
            message: "budget exceeded",
            kind: "message_read_budget_exceeded",
            retryAfterSeconds: 7,
            meta: { requestId: "req_1" },
          },
          response: new Response(null, {
            status: 429,
            headers: { "retry-after": "7" },
          }),
        }),
        "fallback",
      ),
    ).rejects.toMatchObject({
      status: 429,
      kind: "message_read_budget_exceeded",
      retryAfterSeconds: 7,
    });
  });

  it("prefers the Retry-After header over the body delay", async () => {
    await expect(
      executeCoreOperation(
        async () => ({}) as never,
        async () => ({
          error: {
            error: "TooManyRequests",
            message: "budget exceeded",
            retryAfterSeconds: 7,
            meta: { requestId: "req_1" },
          },
          response: new Response(null, {
            status: 429,
            headers: { "retry-after": "11" },
          }),
        }),
        "fallback",
      ),
    ).rejects.toMatchObject({ retryAfterSeconds: 11 });
  });

  it("falls back to the body delay without the header", async () => {
    await expect(
      executeCoreOperation(
        async () => ({}) as never,
        async () => ({
          error: {
            error: "TooManyRequests",
            message: "budget exceeded",
            retryAfterSeconds: 7,
            meta: { requestId: "req_1" },
          },
          response: new Response(null, { status: 429 }),
        }),
        "fallback",
      ),
    ).rejects.toMatchObject({ retryAfterSeconds: 7 });
  });

  it("carries no delay when neither header nor body names one", async () => {
    const error = await executeCoreOperation(
      async () => ({}) as never,
      async () => ({
        error: {
          error: "TooManyRequests",
          message: "slow down",
          meta: { requestId: "req_1" },
        },
        response: new Response(null, { status: 429 }),
      }),
      "fallback",
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(CoreApiRequestError);
    expect((error as CoreApiRequestError).retryAfterSeconds).toBeUndefined();
  });
});

describe("executeCoreOperationWithResponse", () => {
  it("returns the data with the raw response for header reads", async () => {
    const response = new Response(null, { status: 201 });
    // The Response constructor drops forbidden set-cookie headers, so append.
    response.headers.append("set-cookie", "session_token=abc; Path=/");

    const result = await executeCoreOperationWithResponse(
      async () => ({}) as never,
      async () => ({ data: { ok: true }, response }),
      "fallback",
    );

    expect(result.data).toEqual({ ok: true });
    expect(result.response).toBe(response);
    expect(result.response?.headers.getSetCookie()).toEqual([
      "session_token=abc; Path=/",
    ]);
  });

  it("rejects with the same error shape as executeCoreOperation", async () => {
    await expect(
      executeCoreOperationWithResponse(
        async () => ({}) as never,
        async () => ({
          error: {
            error: "Conflict",
            message: "already impersonating",
            meta: { requestId: "req_1" },
          },
          response: new Response(null, { status: 409 }),
        }),
        "fallback",
      ),
    ).rejects.toMatchObject({
      message: "already impersonating",
      status: 409,
      requestId: "req_1",
    });
  });
});
