import { describe, expect, it } from "vitest";

import { sameRoomReadAttention } from "./room-read-attention";

function snapshot() {
  return {
    roomId: "room-1",
    messages: [{ id: "message-1", content: "Question" }],
    openThreadParentId: null as string | null,
    threadMessages: [] as { id: string; content: string }[],
  };
}

describe("sameRoomReadAttention", () => {
  it("changes when a room or thread opens", () => {
    expect(sameRoomReadAttention(null, snapshot())).toBe(false);
    expect(
      sameRoomReadAttention(snapshot(), { ...snapshot(), roomId: "room-2" }),
    ).toBe(false);
    expect(
      sameRoomReadAttention(snapshot(), {
        ...snapshot(),
        openThreadParentId: "thread-1",
      }),
    ).toBe(false);
  });

  it.each(["messages", "threadMessages"] as const)(
    "detects earlier %s content completing before an unchanged newest message",
    (field) => {
      const before = {
        ...snapshot(),
        [field]: [
          { id: "placeholder", content: "" },
          { id: "newest", content: "Question" },
        ],
      };
      const after = {
        ...before,
        [field]: [
          { id: "placeholder", content: "Answer" },
          { id: "newest", content: "Question" },
        ],
      };
      expect(sameRoomReadAttention(before, after)).toBe(false);
    },
  );

  it("ignores object identity and fields outside readable content", () => {
    const before = {
      ...snapshot(),
      messages: [{ id: "m", content: "", metadata: { thought: "one" } }],
    };
    const after = {
      ...snapshot(),
      messages: [{ id: "m", content: "", metadata: { thought: "two" } }],
    };
    expect(sameRoomReadAttention(before, after)).toBe(true);
    expect(sameRoomReadAttention(snapshot(), snapshot())).toBe(true);
  });
});
