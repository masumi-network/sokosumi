import { describe, expect, it } from "vitest";

import { createOAuthClientSchema, parseRedirectUris } from "../utils";

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

describe("createOAuthClientSchema", () => {
  const schema = createOAuthClientSchema(t);

  it("accepts a valid name and redirect URIs", () => {
    const result = schema.safeParse({
      name: "My App",
      redirectUris: "https://example.com/callback",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = schema.safeParse({
      name: "",
      redirectUris: "https://example.com/callback",
    });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only name", () => {
    const result = schema.safeParse({
      name: "   ",
      redirectUris: "https://example.com/callback",
    });
    expect(result.success).toBe(false);
  });

  it("trims name before validation", () => {
    const result = schema.safeParse({
      name: "  My App  ",
      redirectUris: "https://example.com/callback",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("My App");
    }
  });

  it("rejects invalid redirect URIs", () => {
    const result = schema.safeParse({
      name: "My App",
      redirectUris: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});
