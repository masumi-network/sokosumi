import type { ChatRoomMessage } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import type { RoomTranscriptPage } from "@/app/chat/utils/room-transcript-ranges";
import { unreadDividerIn } from "@/app/chat/utils/unread-divider-place";

function page(
  firstUnreadMessageId: string | null | undefined,
  messages: Pick<ChatRoomMessage, "id" | "createdAt">[] = [],
): RoomTranscriptPage {
  return {
    firstUnreadMessageId,
    nextCursor: null,
    // Only id and createdAt are read.
    messages: messages as ChatRoomMessage[],
  };
}

describe("unreadDividerIn", () => {
  it("tells a page that names no divider from a Room with no unread", () => {
    expect(unreadDividerIn(undefined)).toBeUndefined();
    expect(unreadDividerIn(page(undefined))).toBeUndefined();
    expect(unreadDividerIn(null)).toBeNull();
    expect(unreadDividerIn(page(null))).toBeNull();
  });

  it("keeps the time of the named message, or null when the page lacks it", () => {
    const createdAt = new Date("2026-07-01T12:00:00.000Z");
    expect(unreadDividerIn(page("m2", [{ id: "m2", createdAt }]))).toEqual({
      id: "m2",
      at: createdAt.getTime(),
    });
    expect(unreadDividerIn(page("m9", [{ id: "m2", createdAt }]))).toEqual({
      id: "m9",
      at: null,
    });
  });
});
