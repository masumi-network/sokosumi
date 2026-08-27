import { describe, expect, it } from "vitest";

import {
  applyCoreRequestIdHeader,
  attachCoreRequestIdInterceptor,
  CORE_REQUEST_ID_HEADER,
  extractCoreRequestId,
} from "../core-request-id";

describe("applyCoreRequestIdHeader", () => {
  it("sets a request id when the header is missing", () => {
    const headers = new Headers();

    const requestId = applyCoreRequestIdHeader(headers);

    expect(requestId).toEqual(expect.any(String));
    expect(requestId.length).toBeGreaterThan(0);
    expect(headers.get(CORE_REQUEST_ID_HEADER)).toBe(requestId);
  });

  it("keeps an existing request id", () => {
    const headers = new Headers({ [CORE_REQUEST_ID_HEADER]: "req_existing" });

    const requestId = applyCoreRequestIdHeader(headers);

    expect(requestId).toBe("req_existing");
    expect(headers.get(CORE_REQUEST_ID_HEADER)).toBe("req_existing");
  });
});

describe("attachCoreRequestIdInterceptor", () => {
  it("adds a unique request id on each intercepted request", async () => {
    const seen: string[] = [];
    const client = {
      interceptors: {
        request: {
          use(fn: (options: { headers: Headers }) => void) {
            const first = { headers: new Headers() };
            const second = { headers: new Headers() };
            fn(first);
            fn(second);
            seen.push(
              first.headers.get(CORE_REQUEST_ID_HEADER) ?? "",
              second.headers.get(CORE_REQUEST_ID_HEADER) ?? "",
            );
          },
        },
      },
    };

    attachCoreRequestIdInterceptor(client);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(expect.any(String));
    expect(seen[1]).toEqual(expect.any(String));
    expect(seen[0]).not.toBe(seen[1]);
  });

  it("does not attach twice to the same client", () => {
    let useCount = 0;
    const client = {
      interceptors: {
        request: {
          use() {
            useCount += 1;
          },
        },
      },
    };

    attachCoreRequestIdInterceptor(client);
    attachCoreRequestIdInterceptor(client);

    expect(useCount).toBe(1);
  });
});

describe("extractCoreRequestId", () => {
  it("prefers the response header over the error envelope", () => {
    const response = new Response(null, {
      headers: { [CORE_REQUEST_ID_HEADER]: "from_header" },
    });

    expect(
      extractCoreRequestId({
        error: { meta: { requestId: "from_body" } },
        response,
      }),
    ).toBe("from_header");
  });

  it("reads requestId from the Core error envelope", () => {
    expect(
      extractCoreRequestId({
        error: { meta: { requestId: "from_body" } },
      }),
    ).toBe("from_body");
  });
});
