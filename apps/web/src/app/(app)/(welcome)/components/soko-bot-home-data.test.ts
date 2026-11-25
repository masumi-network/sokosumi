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
  const reader = {
    userId: "me",
    from: "You to Wren",
    botId: "bot",
    replied: "Wren replied",
    untitled: "No text",
  };
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

  it("adds the reader's latest question while it waits on the bot, read or not, at the time it was asked", () => {
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

  it("shows the bot's newest reply to that question instead, at the time it replied", () => {
    expect(
      chat([
        message(
          "q1",
          "me",
          "What should I set up first?",
          "2026-11-17T11:50:00Z",
        ),
        message("a1", "bot", "Working on it", "2026-11-17T11:51:00Z"),
        message("a2", "bot", "Start with **Tasks**.", "2026-11-17T11:59:00Z"),
        message("a3", "bot", "Gone", "2026-11-17T11:59:30Z", {
          deletedAt: new Date("2026-11-17T11:59:40Z"),
        }),
        message("o1", "other", "Not the bot", "2026-11-17T11:59:50Z"),
      ]),
    ).toEqual([
      {
        roomId: "bot-room",
        messageId: "a2",
        title: "Start with Tasks.",
        from: "Wren replied",
        at: new Date("2026-11-17T11:59:00Z"),
      },
    ]);
  });

  it("names a reply with no text", () => {
    expect(
      chat([
        message("q1", "me", "Hi", "2026-11-17T10:00:00Z"),
        message("a1", "bot", "", "2026-11-17T10:01:00Z"),
      ])[0],
    ).toMatchObject({
      messageId: "a1",
      title: "No text",
      from: "Wren replied",
    });
  });

  it("never calls another bot's message a reply", () => {
    expect(
      chat([
        message("q1", "me", "Hi", "2026-11-17T10:00:00Z"),
        message("x1", "me", "x", "2026-11-17T10:01:00Z", {
          sender: {
            type: "sokoBot",
            sokoBot: { id: "other-bot", name: "Ash" },
          },
        } as Partial<ChatRoomMessage>),
      ])[0],
    ).toMatchObject({ messageId: "q1", from: "You to Wren" });
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
  const INTRO = "Hi Mira! I'm **Pip**, your personal assistant.";
  const t = (key: string, values?: { name: string }) =>
    values ? `${key}:${values.name}` : key;
  const message = (
    id: string,
    content: string,
    extra: Partial<ChatRoomMessage> = {},
  ) =>
    ({
      id,
      roomId: "bot-room",
      parentMessageId: null,
      content,
      createdAt: new Date("2026-11-24T09:00:00Z"),
      deletedAt: null,
      sender: { type: "sokoBot", sokoBot: { id: "bot" } },
      ...extra,
    }) as ChatRoomMessage;
  const room = (
    messages: ChatRoomMessage[],
    firstUnreadMessageId: string | null,
  ) => ({ roomId: "bot-room", messages, firstUnreadMessageId });

  // Core marks its introduction; the text no longer has to match, so a
  // rename before the welcome is read keeps the row.
  it("finds the marked introduction after a rename", () => {
    const greeted = message("intro", "Hi Mira! I'm **Pip**, before a rename.", {
      metadata: { sokoBotIntroduction: true },
    });
    expect(
      sokoBotWelcomeLead(
        { id: "bot", name: "Juno" },
        "Hi Mara! I'm **Juno**, your personal assistant.",
        room([greeted], "intro"),
        t,
      )?.href,
    ).toBe("/chat/rooms/bot-room?message=intro");
  });

  it("does not call a marked introduction a welcome once read", () => {
    const greeted = message("intro", "Hi", {
      metadata: { sokoBotIntroduction: true },
    });
    expect(sokoBotWelcomeLead(bot, INTRO, room([greeted], null), t)).toBe(
      undefined,
    );
  });

  // Introductions posted before the marker match on Core's text only, so a
  // rename before reading hides those rows; never a notice's.
  it("finds an unmarked older introduction by Core's text", () => {
    expect(
      sokoBotWelcomeLead(
        bot,
        INTRO,
        room([message("intro", INTRO)], "intro"),
        t,
      )?.href,
    ).toBe("/chat/rooms/bot-room?message=intro");
    expect(
      sokoBotWelcomeLead(
        bot,
        "Hi Mara! I'm **Pip**, your personal assistant.",
        room([message("intro", INTRO)], "intro"),
        t,
      ),
    ).toBe(undefined);
  });

  it("lists the bot's unread introduction and opens it in the bot's chat", () => {
    expect(
      sokoBotWelcomeLead(
        bot,
        INTRO,
        room([message("intro", INTRO)], "intro"),
        t,
      ),
    ).toEqual({
      title: "welcome:Pip",
      detail: "openChat",
      href: "/chat/rooms/bot-room?message=intro",
      at: new Date("2026-11-24T09:00:00Z"),
      kind: "message",
    });
  });

  // Core can post an owner notice into a Direct the bot never introduced
  // itself in: that first unread message is not a welcome.
  it("does not call a first-message owner notice a welcome", () => {
    expect(
      sokoBotWelcomeLead(
        bot,
        INTRO,
        room([message("notice", "Your daily brief is ready.")], "notice"),
        t,
      ),
    ).toBe(undefined);
  });

  it("is gone once the read marker moves past the introduction", () => {
    const messages = [
      message("intro", INTRO),
      message("notice", "Your daily brief is ready."),
    ];
    // Read up to the notice, then nothing.
    expect(sokoBotWelcomeLead(bot, INTRO, room(messages, "notice"), t)).toBe(
      undefined,
    );
    expect(sokoBotWelcomeLead(bot, INTRO, room(messages, null), t)).toBe(
      undefined,
    );
  });

  it("needs the live introduction from this bot", () => {
    for (const intro of [
      message("intro", INTRO, { deletedAt: new Date() }),
      message("intro", INTRO, {
        sender: { type: "sokoBot", sokoBot: { id: "other-bot" } },
      } as Partial<ChatRoomMessage>),
    ]) {
      expect(sokoBotWelcomeLead(bot, INTRO, room([intro], "intro"), t)).toBe(
        undefined,
      );
    }
    expect(sokoBotWelcomeLead(bot, INTRO, null, t)).toBe(undefined);
  });
});
