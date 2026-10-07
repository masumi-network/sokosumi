import { describe, expect, it } from "vitest";
import { chatResultPreviewSchema } from "./chat-result-preview.schema";

describe("chat result cards", () => {
  it("keeps unavailable results opaque and rejects external source links", () => {
    expect(
      chatResultPreviewSchema.parse({
        id: "00000000-0000-4000-8000-000000000001",
        state: "unavailable",
      }),
    ).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      state: "unavailable",
    });
    expect(
      chatResultPreviewSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000001",
        state: "available",
        kind: "task",
        capturedAt: "2026-10-06T10:00:00Z",
        title: "Launch",
        sourceHref: "https://evil.example",
        status: "READY",
        outputs: [],
      }).success,
    ).toBe(false);
  });
});
