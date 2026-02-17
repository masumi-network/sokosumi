import { describe, expect, it } from "vitest";

import {
  DEFAULT_ATTACHMENT_MIME_TYPE,
  DEFAULT_ATTACHMENT_NAME,
  DEFAULT_ATTACHMENT_SIZE,
  mapAttachmentForResponse,
} from "./get";

describe("mapAttachmentForResponse", () => {
  it("maps null legacy fields from database rows to safe defaults", () => {
    const mapped = mapAttachmentForResponse(
      {
        id: "att_123",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        jobInputId: "inp_123",
        url: "https://example.com/file.pdf",
        name: null,
        mimeType: null,
        size: null,
      },
      "usr_123",
    );

    expect(mapped.name).toBe(DEFAULT_ATTACHMENT_NAME);
    expect(mapped.size).toBe(DEFAULT_ATTACHMENT_SIZE);
    expect(mapped.mimeType).toBe(DEFAULT_ATTACHMENT_MIME_TYPE);
  });
});
