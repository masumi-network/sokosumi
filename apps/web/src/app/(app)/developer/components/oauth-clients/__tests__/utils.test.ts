import { describe, expect, it } from "vitest";

import {
  createOAuthClientSchema,
  isSafeRedirectUri,
  parseRedirectUris,
} from "../utils";

const t = ((key: string) => key) as Parameters<
  typeof createOAuthClientSchema
>[0];

describe("parseRedirectUris", () => {
  it("splits, trims, and drops empty lines", () => {
    expect(
      parseRedirectUris(" https://example.com/a \n\nhttps://example.com/b\n  "),
    ).toEqual(["https://example.com/a", "https://example.com/b"]);
  });
});

describe("isSafeRedirectUri", () => {
  it("accepts https URLs", () => {
    expect(isSafeRedirectUri("https://example.com/callback")).toBe(true);
  });

  it("accepts loopback http URLs", () => {
    expect(isSafeRedirectUri("http://localhost:3000/callback")).toBe(true);
    expect(isSafeRedirectUri("http://127.0.0.1/callback")).toBe(true);
    expect(isSafeRedirectUri("http://[::1]/callback")).toBe(true);
  });

  it("accepts custom app schemes", () => {
    expect(isSafeRedirectUri("myapp://callback")).toBe(true);
  });

  it("rejects non-loopback http", () => {
    expect(isSafeRedirectUri("http://example.com/callback")).toBe(false);
  });

  it("rejects fragments", () => {
    expect(isSafeRedirectUri("https://example.com/callback#frag")).toBe(false);
  });

  it("rejects dangerous schemes", () => {
    expect(isSafeRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isSafeRedirectUri("data:text/html,hi")).toBe(false);
  });

  it("rejects unparseable strings", () => {
    expect(isSafeRedirectUri("not-a-url")).toBe(false);
  });
});

describe("createOAuthClientSchema", () => {
  const schema = createOAuthClientSchema(t);

  it("accepts a valid name and redirect URIs", () => {
    const result = schema.safeParse({
      name: "My App",
      redirectUris: "https://example.com/callback",
      includeCoreApi: false,
      includeOfflineAccess: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = schema.safeParse({
      name: "",
      redirectUris: "https://example.com/callback",
      includeCoreApi: false,
      includeOfflineAccess: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only name", () => {
    const result = schema.safeParse({
      name: "   ",
      redirectUris: "https://example.com/callback",
      includeCoreApi: false,
      includeOfflineAccess: false,
    });
    expect(result.success).toBe(false);
  });

  it("trims name before validation", () => {
    const result = schema.safeParse({
      name: "  My App  ",
      redirectUris: "https://example.com/callback",
      includeCoreApi: true,
      includeOfflineAccess: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("My App");
      expect(result.data.includeCoreApi).toBe(true);
      expect(result.data.includeOfflineAccess).toBe(false);
    }
  });

  it("rejects invalid redirect URIs", () => {
    const result = schema.safeParse({
      name: "My App",
      redirectUris: "not-a-url",
      includeCoreApi: false,
      includeOfflineAccess: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-loopback http redirect URIs", () => {
    const result = schema.safeParse({
      name: "My App",
      redirectUris: "http://example.com/callback",
      includeCoreApi: false,
      includeOfflineAccess: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing includeOfflineAccess", () => {
    const result = schema.safeParse({
      name: "My App",
      redirectUris: "https://example.com/callback",
      includeCoreApi: false,
    });
    expect(result.success).toBe(false);
  });
});
