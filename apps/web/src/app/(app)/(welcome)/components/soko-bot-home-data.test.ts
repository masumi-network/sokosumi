import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  findSokoBotDirectRoom,
  recentSokoBotRooms,
  toSokoBotChat,
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

describe("recentSokoBotRooms", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const at = (hoursAgo: number) =>
    new Date(now.getTime() - hoursAgo * 3_600_000);
  const rooms = [
    room({ id: "bot-dm", organizationId: null, updatedAt: at(2) }),
    room({ id: "newer", organizationId: null, updatedAt: at(1) }),
    room({ id: "old", organizationId: null, updatedAt: at(25) }),
    room({
      id: "people",
      organizationId: null,
      updatedAt: at(1),
      sokoBotMembers: [],
    }),
    room({ id: "other-org", organizationId: "org-2", updatedAt: at(1) }),
  ];

  it("keeps bot rooms of this workspace that moved in the last day, newest first", () => {
    expect(recentSokoBotRooms(rooms, null, now).map((r) => r.id)).toEqual([
      "newer",
      "bot-dm",
    ]);
  });

  it("keeps another workspace's rooms out and lists a room once", () => {
    expect(
      recentSokoBotRooms([...rooms, rooms[4] as ChatRoom], "org-2", now).map(
        (r) => r.id,
      ),
    ).toEqual(["other-org"]);
  });

  it("caps how many rooms get read", () => {
    expect(recentSokoBotRooms(rooms, null, now, 1)).toHaveLength(1);
  });
});

describe("toSokoBotChat", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const bot = room({
    id: "bot-dm",
    updatedAt: new Date("2026-10-24T11:00:00Z"),
  });
  const message = (
    id: string,
    hoursAgo: number,
    sender: ChatRoomMessage["sender"],
    content = `text ${id}`,
    deletedAt: Date | null = null,
  ) =>
    ({
      id,
      content,
      sender,
      deletedAt,
      createdAt: new Date(now.getTime() - hoursAgo * 3_600_000),
    }) as ChatRoomMessage;
  const me = { type: "user", user: { id: "me" } } as ChatRoomMessage["sender"];
  const other = {
    type: "user",
    user: { id: "u2" },
  } as ChatRoomMessage["sender"];
  const sokoBot = {
    type: "sokoBot",
    sokoBot: { id: "bot" },
  } as ChatRoomMessage["sender"];

  it("titles the chat with the reader's newest message of the day and opens there", () => {
    expect(
      toSokoBotChat(
        bot,
        [
          message("a", 3, me),
          message("b", 2, me),
          message("c", 1, sokoBot),
          message("d", 0.5, other),
          message("e", 0.2, me, "gone", new Date()),
        ],
        "me",
        now,
        "Everyone",
      ),
    ).toEqual({
      roomId: "bot-dm",
      messageId: "b",
      title: "text b",
      at: bot.updatedAt,
    });
  });

  it("is no chat when only the bot spoke or the reader wrote over a day ago", () => {
    expect(
      toSokoBotChat(
        bot,
        [message("welcome", 1, sokoBot), message("old", 30, me)],
        "me",
        now,
        "Everyone",
      ),
    ).toBeNull();
  });
});
