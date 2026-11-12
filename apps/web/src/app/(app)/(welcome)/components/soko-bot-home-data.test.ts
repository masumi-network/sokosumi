import type { ChatRoom } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  findSokoBotDirectRoom,
  toImportantChats,
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

describe("toImportantChats", () => {
  const item = (messageId: string, excerpt: string) => ({
    messageId,
    roomId: `room-${messageId}`,
    roomName: "launch",
    roomKind: "channel" as const,
    parentMessageId: null,
    senderName: "Bob",
    senderImageUrl: null,
    excerpt,
    bucket: "needsYou" as const,
    createdAt: new Date("2026-10-24T10:00:00Z"),
    dueAt: null,
    inReplyTo: null,
  });

  it("keeps Core's order, names the sender and opens the exact message", () => {
    expect(
      toImportantChats(
        [item("m1", "Can you approve the budget?"), item("m2", "")],
        "Message without text",
      ),
    ).toEqual([
      {
        roomId: "room-m1",
        messageId: "m1",
        title: "Can you approve the budget?",
        from: "Bob",
        at: new Date("2026-10-24T10:00:00Z"),
      },
      {
        roomId: "room-m2",
        messageId: "m2",
        title: "Message without text",
        from: "Bob",
        at: new Date("2026-10-24T10:00:00Z"),
      },
    ]);
  });
});
