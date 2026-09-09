import { describe, expect, it } from "vitest";

import { chatRoomsChangedEventSchema } from "./chat-rooms-changed-event";

describe("chatRoomsChangedEventSchema", () => {
  it("parses the Core payload", () => {
    const parsed = chatRoomsChangedEventSchema.safeParse({
      collections: ["active", "archived"],
      roomId: "room-1",
      at: "2026-09-09T12:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a null room for user-wide invalidation", () => {
    expect(
      chatRoomsChangedEventSchema.safeParse({
        collections: ["invitations"],
        roomId: null,
        at: "2026-09-09T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown collections and empty lists", () => {
    expect(
      chatRoomsChangedEventSchema.safeParse({
        collections: ["starred"],
        roomId: null,
        at: "2026-09-09T12:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      chatRoomsChangedEventSchema.safeParse({
        collections: [],
        roomId: null,
        at: "2026-09-09T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});
