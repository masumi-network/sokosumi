import { describe, expect, it } from "vitest";

import { mapAttachmentForResponse } from "./get";

describe("mapAttachmentForResponse", () => {
  it("maps attachment fields and converts size from bigint to number", () => {
    const mapped = mapAttachmentForResponse(
      {
        id: "att_123",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
        updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        jobInputId: "inp_123",
        url: "https://example.com/file.pdf",
        name: "file.pdf",
        mimeType: "application/pdf",
        size: BigInt(1024),
      },
      "usr_123",
    );

    expect(mapped.id).toBe("att_123");
    expect(mapped.referenceId).toBe("inp_123");
    expect(mapped.referenceType).toBe("Input");
    expect(mapped.name).toBe("file.pdf");
    expect(mapped.size).toBe(1024);
    expect(mapped.mimeType).toBe("application/pdf");
    expect(mapped.userId).toBe("usr_123");
  });
});
