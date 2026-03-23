import { describe, expect, it } from "vitest";

import { coworkerSchema } from "./coworker.schema";

describe("coworkerSchema", () => {
  it("parses coworker profile metadata fields", () => {
    const result = coworkerSchema.parse({
      id: "cow_123",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      archivedAt: null,
      isWhitelisted: true,
      slug: "ops-agent",
      name: "Ops Agent",
      url: "https://example.com",
      email: "ops@example.com",
      description: "Ops helper",
      image: "https://example.com/image.png",
      caption: "Senior Campaign Partner",
      company: "Serviceplan",
      companyLogo: "https://example.com/company-logo.png",
      baseURL: "https://responses.example.com/v1",
      capabilities: ["tasks", "chat", "tasks"],
    });

    expect(result.caption).toBe("Senior Campaign Partner");
    expect(result.company).toBe("Serviceplan");
    expect(result.companyLogo).toBe("https://example.com/company-logo.png");
    expect(result.baseURL).toBe("https://responses.example.com/v1");
    expect(result.capabilities).toEqual(["chat", "tasks"]);
    expect(result.archivedAt).toBeNull();
    expect(result.isWhitelisted).toBe(true);
    expect(typeof result.createdAt).toBe("string");
    expect(typeof result.updatedAt).toBe("string");
    expect(result.metadata).toBeNull();
  });

  it("parses metadata channels", () => {
    const result = coworkerSchema.parse({
      id: "cow_123",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      archivedAt: null,
      isWhitelisted: true,
      slug: "ops-agent",
      name: "Ops Agent",
      email: "ops@example.com",
      baseURL: null,
      capabilities: [],
      metadata: {
        channels: {
          email: "foo@bar.com",
          whatsapp: "+49151xxxx",
        },
      },
    });

    expect(result.metadata?.channels.email).toBe("foo@bar.com");
    expect(result.metadata?.channels.whatsapp).toBe("+49151xxxx");
  });

  it("accepts null baseURL", () => {
    const result = coworkerSchema.parse({
      id: "cow_123",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      archivedAt: null,
      isWhitelisted: true,
      slug: "ops-agent",
      name: "Ops Agent",
      email: "ops@example.com",
      baseURL: null,
      capabilities: [],
    });

    expect(result.baseURL).toBeNull();
    expect(result.capabilities).toEqual([]);
  });

  it("fails when isWhitelisted is missing", () => {
    expect(() => {
      coworkerSchema.parse({
        id: "cow_123",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        slug: "ops-agent",
        name: "Ops Agent",
      });
    }).toThrow();
  });

  it("fails when baseURL is missing", () => {
    expect(() => {
      coworkerSchema.parse({
        id: "cow_123",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        archivedAt: null,
        isWhitelisted: true,
        slug: "ops-agent",
        name: "Ops Agent",
        email: "ops@example.com",
      });
    }).toThrow();
  });

  it("fails when capabilities are missing", () => {
    expect(() => {
      coworkerSchema.parse({
        id: "cow_123",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        archivedAt: null,
        isWhitelisted: true,
        slug: "ops-agent",
        name: "Ops Agent",
        email: "ops@example.com",
        baseURL: null,
      });
    }).toThrow();
  });
});
