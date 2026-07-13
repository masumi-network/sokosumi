import { describe, expect, it } from "vitest";

import {
  createCoworkerRequestSchema,
  patchCoworkerRequestSchema,
  patchCoworkerWhitelistRequestSchema,
} from "./schema";

const vendorId = "01960001-0001-7001-8001-000000000001";

describe("createCoworkerRequestSchema", () => {
  it("accepts valid HTTP(S) values for url", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      vendorId: "01960001-0001-7001-8001-000000000001",
      url: "http://example.com",
      baseURL: "https://responses.example.com/v1",
    });

    expect(result.success).toBe(true);
  });

  it("accepts null baseURL", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      vendorId,
      baseURL: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBeUndefined();
    }
  });

  it("accepts capabilities and normalizes them", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      vendorId,
      capabilities: ["tasks", "chat", "tasks"],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities).toEqual(["chat", "tasks"]);
    }
  });

  it("accepts explicit integer priority", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      vendorId,
      priority: 10,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe(10);
    }
  });

  it("rejects non-integer priority", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      vendorId,
      priority: 2.5,
    });

    expect(result.success).toBe(false);
  });

  it("rejects unsupported capabilities", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      vendorId,
      capabilities: ["search"],
    });

    expect(result.success).toBe(false);
  });

  it("requires vendorId on create", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
    });

    expect(result.success).toBe(false);
  });

  it("rejects url when it is not HTTP(S)", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      vendorId,
      url: "mailto:ops@example.com",
    });

    expect(result.success).toBe(false);
  });

  it("rejects names shorter than 3 characters", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "ab",
    });

    expect(result.success).toBe(false);
  });

  it("strips isWhitelisted when provided", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      vendorId,
      isWhitelisted: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("isWhitelisted");
    }
  });

  it("accepts metadata with channels", () => {
    const result = createCoworkerRequestSchema.safeParse({
      name: "Ops Agent",
      vendorId,
      metadata: {
        channels: {
          email: "foo@bar.com",
          whatsapp: "+49151xxxx",
        },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata?.channels.email).toBe("foo@bar.com");
      expect(result.data.metadata?.channels.whatsapp).toBe("+49151xxxx");
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

  it("accepts capabilities-only updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      capabilities: ["tasks", "chat", "tasks"],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities).toEqual(["chat", "tasks"]);
    }
  });

  it("accepts priority-only updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      priority: 10,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe(10);
    }
  });

  it("rejects invalid url updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      url: "not-a-url",
    });

    expect(result.success).toBe(false);
  });

  it("rejects vendorId on patch", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      vendorId: "01960001-0001-7001-8001-000000000001",
      name: "Ops Agent",
    });

    expect(result.success).toBe(false);
  });

  it("rejects whitelist-only updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      isWhitelisted: true,
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid capabilities updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      capabilities: ["search"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-integer priority updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      priority: 2.5,
    });

    expect(result.success).toBe(false);
  });

  it("accepts metadata-only updates", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      metadata: {
        channels: {
          whatsapp: "+49151xxxx",
        },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata?.channels.whatsapp).toBe("+49151xxxx");
    }
  });

  it("accepts null metadata to clear", () => {
    const result = patchCoworkerRequestSchema.safeParse({
      metadata: null,
    });

    expect(result.success).toBe(true);
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
