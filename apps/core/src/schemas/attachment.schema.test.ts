import { describe, expect, it } from "vitest";

import { attachmentSchema } from "./attachment.schema";

const baseAttachment = {
  id: "att_123",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
  userId: "usr_123",
  referenceId: "inp_123",
  referenceType: "Input" as const,
  name: "file.pdf",
  size: 1024,
  mimeType: "application/pdf",
  url: "https://example.com/file.pdf",
};

describe("attachmentSchema", () => {
  it("parses a valid attachment with mimeType", () => {
    const result = attachmentSchema.parse(baseAttachment);

    expect(result.mimeType).toBe("application/pdf");
  });

  it("fails when name is null", () => {
    expect(() =>
      attachmentSchema.parse({
        ...baseAttachment,
        name: null,
      }),
    ).toThrow();
  });

  it("fails when size is null", () => {
    expect(() =>
      attachmentSchema.parse({
        ...baseAttachment,
        size: null,
      }),
    ).toThrow();
  });

  it("fails when mimeType is null", () => {
    expect(() =>
      attachmentSchema.parse({
        ...baseAttachment,
        mimeType: null,
      }),
    ).toThrow();
  });
});
