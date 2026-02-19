import { describe, expect, it } from "vitest";

import { noticeSchema } from "./notice.schema";

describe("noticeSchema", () => {
  it("parses notices with a supported kind", () => {
    const result = noticeSchema.parse({
      id: "notice_123",
      kind: "LEGAL_TERMS",
      bodyMarkdown: "## Terms update",
      effectiveAt: "2026-02-20T09:00:00.000Z",
      isActive: true,
      createdAt: "2026-02-19T10:00:00.000Z",
      updatedAt: "2026-02-19T10:00:00.000Z",
    });

    expect(result.kind).toBe("LEGAL_TERMS");
  });

  it("rejects unknown notice kinds", () => {
    expect(() => {
      noticeSchema.parse({
        id: "notice_123",
        kind: "PRODUCT_UPDATE",
        bodyMarkdown: "## Terms update",
        effectiveAt: "2026-02-20T09:00:00.000Z",
        isActive: true,
        createdAt: "2026-02-19T10:00:00.000Z",
        updatedAt: "2026-02-19T10:00:00.000Z",
      });
    }).toThrow();
  });
});
