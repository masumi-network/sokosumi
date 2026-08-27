import { describe, expect, it } from "vitest";

import { normalizeOAuthIssuerBase } from "./oauth-issuer";

describe("normalizeOAuthIssuerBase", () => {
  it("normalizes https issuer without trailing slash", () => {
    expect(normalizeOAuthIssuerBase("https://app.example/api/auth")).toBe(
      "https://app.example/api/auth",
    );
  });

  it("strips trailing slash on path", () => {
    expect(normalizeOAuthIssuerBase("https://app.example/api/auth/")).toBe(
      "https://app.example/api/auth",
    );
  });

  it("allows http for local dev", () => {
    expect(normalizeOAuthIssuerBase("http://localhost:3000/api/auth")).toBe(
      "http://localhost:3000/api/auth",
    );
  });

  it("rejects javascript URLs", () => {
    expect(normalizeOAuthIssuerBase("javascript:alert(1)")).toBeNull();
  });

  it("rejects URLs with userinfo", () => {
    expect(
      normalizeOAuthIssuerBase("https://evil@trusted.example/api/auth"),
    ).toBeNull();
  });

  it("rejects invalid URLs", () => {
    expect(normalizeOAuthIssuerBase("not-a-url")).toBeNull();
  });

  it("rejects empty and whitespace", () => {
    expect(normalizeOAuthIssuerBase("")).toBeNull();
    expect(normalizeOAuthIssuerBase("   ")).toBeNull();
  });
});
