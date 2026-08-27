import { describe, expect, it } from "vitest";

import { buildCoreChatProxyHeaders } from "./build-core-chat-proxy-headers";

describe("buildCoreChatProxyHeaders", () => {
  it("copies cookie, authorization, and x-organization-slug only", () => {
    const incoming = new Headers({
      cookie: "session=abc",
      authorization: "Bearer token",
      "x-organization-slug": "acme",
      host: "app.example.com",
      "transfer-encoding": "chunked",
      "content-length": "42",
    });

    const out = buildCoreChatProxyHeaders(incoming);

    expect(out.get("cookie")).toBe("session=abc");
    expect(out.get("authorization")).toBe("Bearer token");
    expect(out.get("x-organization-slug")).toBe("acme");
    expect(out.has("host")).toBe(false);
    expect(out.has("transfer-encoding")).toBe(false);
    expect(out.has("content-length")).toBe(false);
  });

  it("returns empty headers when no allowlisted values are present", () => {
    const incoming = new Headers({
      "x-forwarded-for": "1.2.3.4",
      "transfer-encoding": "chunked",
    });

    const out = buildCoreChatProxyHeaders(incoming);

    expect([...out.keys()]).toHaveLength(0);
  });
});
