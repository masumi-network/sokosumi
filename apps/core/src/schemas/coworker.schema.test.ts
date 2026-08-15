import { describe, expect, it } from "vitest";

import { vendorSchema } from "@/schemas/vendor.schema";

import { coworkerOfferSchema, coworkerSchema } from "./coworker.schema";

const sampleVendor = {
  id: "01960001-0001-7001-8001-000000000001",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
  name: "Serviceplan",
  slug: "serviceplan",
  logos: {
    light: "https://example.com/company-logo.png",
    dark: null,
  },
};

describe("coworkerSchema", () => {
  it("parses coworker profile metadata fields", () => {
    const result = coworkerSchema.parse({
      id: "cow_123",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      archivedAt: null,
      isWhitelisted: true,
      priority: 10,
      completedTaskCount: 0,
      slug: "ops-agent",
      name: "Ops Agent",
      url: "https://example.com",
      description: "Ops helper",
      image: "https://example.com/image.png",
      caption: "Senior Campaign Partner",
      vendor: sampleVendor,
      baseURL: "https://responses.example.com/v1",
      capabilities: ["tasks", "chat", "tasks"],
    });

    expect(result.caption).toBe("Senior Campaign Partner");
    expect(result.vendor).toEqual(vendorSchema.parse(sampleVendor));
    expect(result.baseURL).toBe("https://responses.example.com/v1");
    expect(result.capabilities).toEqual(["chat", "tasks"]);
    expect(result.archivedAt).toBeNull();
    expect(result.isWhitelisted).toBe(true);
    expect(result.priority).toBe(10);
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
      priority: 0,
      completedTaskCount: 0,
      slug: "ops-agent",
      name: "Ops Agent",
      vendor: sampleVendor,
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
      priority: 0,
      completedTaskCount: 0,
      slug: "ops-agent",
      name: "Ops Agent",
      vendor: sampleVendor,
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
        completedTaskCount: 0,
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
        priority: 0,
        completedTaskCount: 0,
        slug: "ops-agent",
        name: "Ops Agent",
      });
    }).toThrow();
  });

  it("fails when priority is missing", () => {
    expect(() => {
      coworkerSchema.parse({
        id: "cow_123",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        archivedAt: null,
        isWhitelisted: true,
        completedTaskCount: 0,
        slug: "ops-agent",
        name: "Ops Agent",
        baseURL: null,
        capabilities: [],
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
        priority: 0,
        completedTaskCount: 0,
        slug: "ops-agent",
        name: "Ops Agent",
        baseURL: null,
      });
    }).toThrow();
  });
});

describe("coworkerOfferSchema output types", () => {
  function parseType(type: string): string | undefined {
    return coworkerOfferSchema.parse({
      title: "Title",
      prompt: "Prompt",
      outputs: [{ type, url: "https://example.com/file" }],
    }).outputs?.[0].type;
  }

  it("normalizes common file extensions to canonical kinds", () => {
    expect(parseType("docx")).toBe("doc");
    expect(parseType("pptx")).toBe("slides");
    expect(parseType("xlsx")).toBe("sheet");
    expect(parseType("xls")).toBe("sheet");
    expect(parseType("csv")).toBe("sheet");
    expect(parseType("png")).toBe("image");
  });

  it("passes canonical kinds through unchanged", () => {
    for (const kind of [
      "pdf",
      "image",
      "slides",
      "doc",
      "sheet",
      "text",
      "html",
    ]) {
      expect(parseType(kind)).toBe(kind);
    }
  });

  it("is case-insensitive", () => {
    expect(parseType("XLSX")).toBe("sheet");
    expect(parseType("PDF")).toBe("pdf");
  });

  it("rejects unknown output types", () => {
    expect(() => parseType("zip")).toThrow();
  });

  it("accepts and normalizes multiple outputs", () => {
    const result = coworkerOfferSchema.parse({
      title: "Title",
      prompt: "Prompt",
      outputs: [
        { type: "docx", url: "https://example.com/a.docx", label: "Brief" },
        { type: "xlsx", url: "https://example.com/b.xlsx", label: "Data" },
      ],
    });
    expect(result.outputs?.map((output) => output.type)).toEqual([
      "doc",
      "sheet",
    ]);
  });
});
