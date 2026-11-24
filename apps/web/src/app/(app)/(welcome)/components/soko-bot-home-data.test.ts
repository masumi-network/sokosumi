import type { ChatRoom, ChatRoomMessage } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  findSokoBotDirectRoom,
  sokoBotWelcomeLead,
  toImportantChats,
  toNewSchedules,
  toTeamDay,
  withSokoBotChat,
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

describe("toNewSchedules", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const schedule = (id: string, hoursAgo: number, systemKey?: string) => ({
    id,
    name: `Schedule ${id}`,
    systemKey: systemKey ?? null,
    createdAt: new Date(now.getTime() - hoursAgo * 3_600_000),
  });

  it("keeps the bot's own schedules from the last 24 hours, newest first", () => {
    const rows = toNewSchedules(
      [
        schedule("old", 30),
        schedule("a", 5),
        schedule("built-in", 1, "daily_standup"),
        schedule("b", 1),
      ],
      now,
    );
    expect(rows).toEqual([
      { id: "b", name: "Schedule b", createdAt: schedule("b", 1).createdAt },
      { id: "a", name: "Schedule a", createdAt: schedule("a", 5).createdAt },
    ]);
  });

  it("caps the list", () => {
    const schedules = Array.from({ length: 12 }, (_, i) =>
      schedule(`s${i}`, i),
    );
    expect(toNewSchedules(schedules, now, 3)).toHaveLength(3);
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

describe("withSokoBotChat", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const reader = { userId: "me", from: "You to Wren", untitled: "No text" };
  const message = (
    id: string,
    sender: "me" | "other" | "bot",
    content: string,
    createdAt: string,
    extra: Partial<ChatRoomMessage> = {},
  ) =>
    ({
      id,
      roomId: "bot-room",
      parentMessageId: null,
      content,
      createdAt: new Date(createdAt),
      deletedAt: null,
      sender:
        sender === "bot"
          ? { type: "sokoBot", sokoBot: { id: "bot", name: "Wren" } }
          : { type: "user", user: { id: sender, name: sender } },
      ...extra,
    }) as ChatRoomMessage;
  const chat = (
    messages: ChatRoomMessage[],
    chats: Parameters<typeof withSokoBotChat>[0] = [],
  ) => withSokoBotChat(chats, { roomId: "bot-room", messages }, reader, now);

  it("adds the reader's latest question to the bot, read or not, at the time it was asked", () => {
    expect(
      chat([
        message("q1", "me", "Old question", "2026-11-17T09:00:00Z"),
        message("a1", "bot", "Old answer", "2026-11-17T09:01:00Z"),
        message(
          "q2",
          "me",
          "What should I **set up** first?",
          "2026-11-17T11:58:00Z",
        ),
        message("a2", "bot", "Start with Tasks.", "2026-11-17T11:59:00Z"),
      ]),
    ).toEqual([
      {
        roomId: "bot-room",
        messageId: "q2",
        title: "What should I set up first?",
        from: "You to Wren",
        at: new Date("2026-11-17T11:58:00Z"),
      },
    ]);
  });

  it("skips deleted questions and other people's messages", () => {
    expect(
      chat([
        message("q1", "me", "Kept", "2026-11-17T10:00:00Z"),
        message("q2", "me", "Gone", "2026-11-17T10:05:00Z", {
          deletedAt: new Date("2026-11-17T10:06:00Z"),
        }),
        message("o1", "other", "Not mine", "2026-11-17T10:07:00Z"),
      ])[0]?.messageId,
    ).toBe("q1");
  });

  it("names a question with no text", () => {
    expect(
      chat([message("q1", "me", "", "2026-11-17T10:00:00Z")])[0]?.title,
    ).toBe("No text");
  });

  it("adds nothing when the question is over a day old or the reader never asked", () => {
    expect(
      chat([message("q1", "me", "Yesterday", "2026-11-16T11:59:00Z")]),
    ).toEqual([]);
    // The bot posting today does not make an old question new.
    expect(
      chat([
        message("q1", "me", "Last week", "2026-11-10T09:00:00Z"),
        message("a1", "bot", "Your Monday digest", "2026-11-17T11:00:00Z"),
      ]),
    ).toEqual([]);
    expect(
      chat([message("a1", "bot", "Hello!", "2026-11-17T11:00:00Z")]),
    ).toEqual([]);
    expect(withSokoBotChat([], null, reader, now)).toEqual([]);
  });

  it("keeps the unread row instead when the bot's room is already listed", () => {
    const unread = {
      roomId: "bot-room",
      messageId: "a1",
      title: "Done: your plan",
      from: "Wren",
      at: new Date("2026-11-17T11:00:00Z"),
    };
    expect(
      chat(
        [message("q1", "me", "Plan my day", "2026-11-17T10:00:00Z")],
        [unread],
      ),
    ).toEqual([unread]);
  });
});

describe("sokoBotWelcomeLead", () => {
  const bot = { id: "bot", name: "Pip" };
  const t = (key: string, values?: { name: string }) =>
    values ? `${key}:${values.name}` : key;
  const message = (
    id: string,
    sender: "me" | "bot",
    extra: Partial<ChatRoomMessage> = {},
  ) =>
    ({
      id,
      roomId: "bot-room",
      parentMessageId: null,
      content: "Hi",
      createdAt: new Date("2026-11-24T09:00:00Z"),
      deletedAt: null,
      sender:
        sender === "me"
          ? { type: "user", user: { id: "me" } }
          : { type: "sokoBot", sokoBot: { id: "bot" } },
      ...extra,
    }) as ChatRoomMessage;
  const welcomeRoom = {
    roomId: "bot-room",
    messages: [message("welcome", "bot")],
    unread: 1,
    complete: true,
  };

  it("lists the bot's unread welcome and opens it in the bot's chat", () => {
    expect(sokoBotWelcomeLead(bot, welcomeRoom, t)).toEqual({
      title: "welcome:Pip",
      detail: "openChat",
      href: "/chat/rooms/bot-room?message=welcome",
      at: new Date("2026-11-24T09:00:00Z"),
      kind: "message",
    });
  });

  it("is gone once the welcome is read", () => {
    expect(sokoBotWelcomeLead(bot, { ...welcomeRoom, unread: 0 }, t)).toBe(
      undefined,
    );
  });

  it("is gone when only a later bot message is unread", () => {
    const room = {
      ...welcomeRoom,
      messages: [message("welcome", "bot"), message("later", "bot")],
      unread: 1,
    };
    expect(sokoBotWelcomeLead(bot, room, t)).toBe(undefined);
  });

  it("is gone once the reader wrote back", () => {
    const room = {
      ...welcomeRoom,
      messages: [message("welcome", "bot"), message("question", "me")],
    };
    expect(sokoBotWelcomeLead(bot, room, t)).toBe(undefined);
  });

  it("needs the bot's first message, not just any unread one", () => {
    for (const room of [
      // Older messages exist past this page.
      { ...welcomeRoom, complete: false },
      // The welcome was deleted.
      {
        ...welcomeRoom,
        messages: [message("welcome", "bot", { deletedAt: new Date() })],
      },
      null,
    ]) {
      expect(sokoBotWelcomeLead(bot, room, t)).toBe(undefined);
    }
  });
});
