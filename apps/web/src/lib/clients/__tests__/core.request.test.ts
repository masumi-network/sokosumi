import { describe, expect, it } from "vitest";

import { executeCoreOperation } from "../core.request";
import { CORE_REQUEST_ID_HEADER } from "../utils/core-request-id";

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
});
