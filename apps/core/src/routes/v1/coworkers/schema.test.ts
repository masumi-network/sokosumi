import { describe, expect, it } from "vitest";

import {
  createCoworkerRequestSchema,
  patchCoworkerRequestSchema,
} from "./schema";

describe("createCoworkerRequestSchema", () => {
  it("accepts valid HTTP(S) values for companyLogo and url", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      email: "ops@example.com",
      companyLogo: "https://example.com/company-logo.png",
      url: "http://example.com",
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

  it("rejects invalid url updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      url: "not-a-url",
    });

    expect(result.success).toBe(false);
  });
});
