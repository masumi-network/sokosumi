import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

import { sanitizeForwardCookieHeader } from "../forward-cookies";

describe("sanitizeForwardCookieHeader", () => {
  it("prefers __Secure- session_token over a stale host-only duplicate", () => {
    const sanitized = sanitizeForwardCookieHeader(
      [
        "sokosumi.session_token=stale-host-only",
        "__Secure-sokosumi.session_token=valid-secure",
        "other=value",
      ].join("; "),
    );

    expect(sanitized).toBe(
      "__Secure-sokosumi.session_token=valid-secure; other=value",
    );
    expect(sanitized).not.toContain("stale-host-only");
  });

  it("keeps the first value when the same cookie name appears twice", () => {
    const sanitized = sanitizeForwardCookieHeader(
      "sokosumi.session_token=valid; other=1; sokosumi.session_token=stale",
    );

    expect(sanitized).toBe("sokosumi.session_token=valid; other=1");
  });

  it("collapses secure and non-secure session_data cookies", () => {
    const sanitized = sanitizeForwardCookieHeader(
      [
        "sokosumi.session_data=old-cache",
        "__Secure-sokosumi.session_data=new-cache",
      ].join("; "),
    );

    expect(sanitized).toBe("__Secure-sokosumi.session_data=new-cache");
  });
});
