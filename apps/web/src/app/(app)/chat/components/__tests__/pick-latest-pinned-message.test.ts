import { describe, expect, it } from "vitest";
import type {
  ChatRoomMessage,
  ChatRoomPinnedMessageListItem,
} from "@/lib/clients/generated/core";
import { pickLatestPinnedMessage } from "../pick-latest-pinned-message";

function message(id: string, content: string): ChatRoomMessage {
  return {
    id,
    roomId: "room-1",
    parentMessageId: null,
    content,
    createdAt: new Date("2026-08-26T12:00:00.000Z"),
    editedAt: null,
    deletedAt: null,
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    unfurls: null,
    sender: {
      type: "user",
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
  };
}

function pin(
  overrides: Partial<ChatRoomPinnedMessageListItem> &
    Pick<ChatRoomPinnedMessageListItem, "messageId">,
): ChatRoomPinnedMessageListItem {
  return {
    pinnedAt: new Date("2026-08-26T12:00:00.000Z"),
    pinnedBy: { id: "user-1", name: "Ada" },
    message: message(overrides.messageId, "Pinned"),
    ...overrides,
  };
}

describe("pickLatestPinnedMessage", () => {
  it("returns null when there are no pins", () => {
    expect(pickLatestPinnedMessage([])).toBeNull();
  });

  it("returns the first pin because the API lists newest pin first", () => {
    const latest = pin({
      messageId: "msg-new",
      message: message("msg-new", "Newest pin"),
    });
    const older = pin({
      messageId: "msg-old",
      message: message("msg-old", "Older pin"),
    });

    expect(pickLatestPinnedMessage([latest, older])).toBe(latest);
  });

  it("skips a deleted latest pin in favor of the next loadable message", () => {
    const deletedLatest = pin({
      messageId: "msg-deleted",
      message: null,
    });
    const loadable = pin({
      messageId: "msg-ok",
      message: message("msg-ok", "Still here"),
    });

    expect(pickLatestPinnedMessage([deletedLatest, loadable])).toBe(loadable);
  });

  it("returns the deleted latest pin when nothing else loaded", () => {
    const deletedLatest = pin({
      messageId: "msg-deleted",
      message: null,
    });

    expect(pickLatestPinnedMessage([deletedLatest])).toBe(deletedLatest);
  });
});
