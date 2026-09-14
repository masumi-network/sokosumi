import { describe, expect, it } from "vitest";

import {
  CoreApiRequestError,
  executeCoreOperation,
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
