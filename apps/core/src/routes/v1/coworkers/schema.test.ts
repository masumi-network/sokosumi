import { describe, expect, it } from "vitest";

import {
  createCoworkerRequestSchema,
  patchCoworkerRequestSchema,
  patchCoworkerWhitelistRequestSchema,
} from "./schema";

describe("createCoworkerRequestSchema", () => {
  it("accepts valid HTTP(S) values for companyLogo and url", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      email: "ops@example.com",
      companyLogo: "https://example.com/company-logo.png",
      url: "http://example.com",
      baseURL: "https://responses.example.com/v1",
    });

    expect(result.success).toBe(true);
  });

  it("accepts null baseURL", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      email: "ops@example.com",
      baseURL: null,
    });

    expect(result.success).toBe(true);
  });

  it("rejects companyLogo when it is not a valid URL", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      email: "ops@example.com",
      companyLogo: "not-a-url",
    });

    expect(result.success).toBe(false);
  });

  it("rejects url when it is not HTTP(S)", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      email: "ops@example.com",
      url: "mailto:ops@example.com",
    });

    expect(result.success).toBe(false);
  });

  it("rejects names shorter than 3 characters", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "ab",
      email: "ops@example.com",
    });

    expect(result.success).toBe(false);
  });

  it("strips isWhitelisted when provided", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      email: "ops@example.com",
      isWhitelisted: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("isWhitelisted");
    }
  });
});

describe("patchCoworkerRequestSchema", () => {
  it("requires at least one field", () => {
    const result = patchCoworkerRequestSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it("accepts valid url updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      url: "https://example.com",
    });

    expect(result.success).toBe(true);
  });

  it("accepts baseURL-only updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      baseURL: "https://responses.example.com/v1",
    });

    expect(result.success).toBe(true);
  });

  it("accepts null baseURL updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      baseURL: null,
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid url updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      url: "not-a-url",
    });

    expect(result.success).toBe(false);
  });

  it("rejects whitelist-only updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      isWhitelisted: true,
    });

    expect(result.success).toBe(false);
  });
});

describe("patchCoworkerWhitelistRequestSchema", () => {
  it("accepts boolean whitelist updates", () => {
    const result = patchCoworkerWhitelistRequestSchema.safeParse({
      isWhitelisted: true,
    });

    expect(result.success).toBe(true);
  });

  it("rejects missing whitelist value", () => {
    const result = patchCoworkerWhitelistRequestSchema.safeParse({});

    expect(result.success).toBe(false);
  });
});
