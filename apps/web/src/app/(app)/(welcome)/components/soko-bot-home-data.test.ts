import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  chatTitle,
  findSokoBotDirectRoom,
  toRecentChats,
} from "./soko-bot-home-data";

function room(overrides: Partial<ChatRoom>): ChatRoom {
  return {
    id: "room",
    kind: "direct",
    userMembers: [{ id: "me" }],
    coworkerMembers: [],
    sokoBotMembers: [{ id: "bot" }],
    ...overrides,
  } as ChatRoom;
}

function message(
  id: string,
  content: string,
  overrides: Partial<ChatRoomMessage> = {},
): ChatRoomMessage {
  return {
    id,
    content,
    createdAt: new Date(`2026-10-0${id.slice(-1)}T10:00:00Z`),
    deletedAt: null,
    parentMessageId: null,
    sender: { type: "user", user: { id: "me" } },
    ...overrides,
  } as ChatRoomMessage;
}

describe("findSokoBotDirectRoom", () => {
  it("finds the user's Direct with exactly this bot", () => {
    const rooms = [
      room({ id: "channel", kind: "channel" }),
      room({ id: "other-bot", sokoBotMembers: [{ id: "x" }] as never }),
      room({ id: "with-coworker", coworkerMembers: [{ id: "c" }] as never }),
      room({ id: "bot-room" }),
    ];
    expect(findSokoBotDirectRoom(rooms, "bot")?.id).toBe("bot-room");
  });

  it("returns null when the bot has no Direct yet", () => {
    expect(findSokoBotDirectRoom([room({ kind: "channel" })], "bot")).toBe(
      null,
    );
  });
});

describe("chatTitle", () => {
  it("keeps the first non-empty line as plain text", () => {
    expect(chatTitle("\n  **Plan** my [week](https://x.y)\nmore")).toBe(
      "Plan my week",
    );
  });

  it("returns null for blank content", () => {
    expect(chatTitle("  \n ")).toBe(null);
  });
});

describe("toRecentChats", () => {
  it("lists the user's own top-level messages newest first", () => {
    const messages = [
      message("m1", "First ask"),
      message("m2", "Bot reply", {
        sender: { type: "sokoBot", sokoBot: { id: "bot" } } as never,
      }),
      message("m3", "Thread reply", { parentMessageId: "m1" }),
      message("m4", "Deleted", { deletedAt: new Date() }),
      message("m5", "Second ask"),
    ];
    expect(toRecentChats(messages, "me").map((chat) => chat.title)).toEqual([
      "Second ask",
      "First ask",
    ]);
  });

  it("caps the list", () => {
    const messages = ["m1", "m2", "m3"].map((id) => message(id, id));
    expect(toRecentChats(messages, "me", 2)).toHaveLength(2);
  });
});
