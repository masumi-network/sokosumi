import type { ChatRoom } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  findSokoBotDirectRoom,
  toSokoBotChats,
  toTeamDay,
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

describe("toTeamDay", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const task = (id: string, hoursAgo: number, extra = {}) => ({
    id,
    name: `Task ${id}`,
    status: "COMPLETED" as const,
    updatedAt: new Date(now.getTime() - hoursAgo * 3_600_000),
    assignee: null,
    owner: { id: "u", name: "Patrick" },
    ...extra,
  });

  it("keeps the last 24 hours, newest first, and names who has it", () => {
    const rows = toTeamDay(
      [
        task("old", 30),
        task("a", 5),
        task("b", 1, {
          assignee: {
            type: "user" as const,
            id: "u2",
            user: { id: "u2", name: "Hannah" },
          },
        }),
      ],
      now,
    );
    expect(rows.map((row) => [row.id, row.who])).toEqual([
      ["b", "Hannah"],
      ["a", "Patrick"],
    ]);
  });

  it("caps the list", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(`t${i}`, i));
    expect(toTeamDay(tasks, now, 3)).toHaveLength(3);
  });
});

describe("toSokoBotChats", () => {
  const lena = "019fc7e4-e4bd-7005-900c-66e44d33f5e4";
  const roomAt = new Date("2026-10-24T11:00:00Z");
  const rooms = [
    room({ id: "dm", updatedAt: roomAt }),
    room({
      id: "thread-room",
      updatedAt: new Date("2026-10-23T08:00:00Z"),
      userMembers: [{ id: lena, name: "Lena" }] as never,
    }),
  ];
  const row = (roomId: string, extra = {}) => ({
    roomId,
    messageId: `${roomId}-msg`,
    parentMessageId: null,
    content: `asked in ${roomId}`,
    createdAt: new Date("2026-10-24T10:00:00Z"),
    ...extra,
  });

  it("keeps Core's order and opens the exact message, a Thread reply included", () => {
    const chats = toSokoBotChats(
      [
        row("thread-room", {
          messageId: "reply-1",
          parentMessageId: "parent-1",
          createdAt: new Date("2026-10-24T11:30:00Z"),
        }),
        row("dm"),
      ],
      rooms,
      "Everyone",
      "Message without text",
    );
    expect(chats.map((chat) => [chat.roomId, chat.messageId])).toEqual([
      ["thread-room", "reply-1"],
      ["dm", "dm-msg"],
    ]);
    // A reply leaves the room's timestamp alone: the row shows the reply's.
    expect(chats[0]?.at).toEqual(new Date("2026-10-24T11:30:00Z"));
    expect(chats[1]?.at).toEqual(roomAt);
  });

  it("names mentions, labels a message with no text, and drops a room the list lacks", () => {
    expect(
      toSokoBotChats(
        [
          row("thread-room", { content: `ask @${lena}` }),
          row("dm", { content: "" }),
          row("gone"),
        ],
        rooms,
        "Everyone",
        "Message without text",
      ).map((chat) => chat.title),
    ).toEqual(["ask @Lena", "Message without text"]);
  });
});
