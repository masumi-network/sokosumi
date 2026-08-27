import { describe, expect, it } from "vitest";

import { buildCoreChatProxyHeaders } from "../build-core-chat-proxy-headers";
import { CORE_REQUEST_ID_HEADER } from "../core-request-id";

describe("buildCoreChatProxyHeaders", () => {
  it("copies cookie, authorization, organization slug, and request id", () => {
    const incoming = new Headers({
      cookie: "session=abc",
      authorization: "Bearer token",
      "x-organization-slug": "acme",
      [CORE_REQUEST_ID_HEADER]: "req_incoming",
      host: "app.example.com",
      "transfer-encoding": "chunked",
      "content-length": "42",
    });

    const out = buildCoreChatProxyHeaders(incoming);

    expect(out.get("cookie")).toBe("session=abc");
    expect(out.get("authorization")).toBe("Bearer token");
    expect(out.get("x-organization-slug")).toBe("acme");
    expect(out.get(CORE_REQUEST_ID_HEADER)).toBe("req_incoming");
    expect(out.has("host")).toBe(false);
    expect(out.has("transfer-encoding")).toBe(false);
    expect(out.has("content-length")).toBe(false);
  });

  it("mints a request id when the incoming request has none", () => {
    const incoming = new Headers({
      "x-forwarded-for": "1.2.3.4",
      "transfer-encoding": "chunked",
    });

    const out = buildCoreChatProxyHeaders(incoming);

    expect([...out.keys()]).toEqual([CORE_REQUEST_ID_HEADER]);
    expect(out.get(CORE_REQUEST_ID_HEADER)).toEqual(expect.any(String));
  });
});
