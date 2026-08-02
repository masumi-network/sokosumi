import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import {
  mergeMessagesWithStreamOverlay,
  mergeRoomMessages,
} from "../merge-room-messages";

function message(id: string, createdAt: string, content = id): ChatRoomMessage {
  return {
    id,
    roomId: "room-1",
    parentMessageId: null,
    content,
    createdAt: new Date(createdAt),
    editedAt: null,
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
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    deletedAt: null,
  };
}

function coworkerMessage(
  id: string,
  createdAt: string,
  content: string,
): ChatRoomMessage {
  return {
    ...message(id, createdAt, content),
    sender: {
      type: "coworker",
      coworker: {
        id: "cow-1",
        name: "Jamal",
        slug: "jamal",
        caption: null,
        image: null,
        presence: "online",
      },
    },
  };
}

describe("mergeRoomMessages", () => {
  it("keeps older loaded history when refreshing the latest page", () => {
    const older = message("m1", "2026-07-01T10:00:00.000Z");
    const mid = message("m2", "2026-07-01T11:00:00.000Z");
    const latest = message("m3", "2026-07-01T12:00:00.000Z");
    const refreshedLatest = message(
      "m3",
      "2026-07-01T12:00:00.000Z",
      "updated",
    );
    const newer = message("m4", "2026-07-01T13:00:00.000Z");

    const merged = mergeRoomMessages(
      [older, mid, latest],
      [refreshedLatest, newer],
    );

    expect(merged.map((row) => row.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(merged[2]?.content).toBe("updated");
  });

  it("prepends an older page without duplicating ids", () => {
    const older = message("m1", "2026-07-01T10:00:00.000Z");
    const mid = message("m2", "2026-07-01T11:00:00.000Z");
    const latest = message("m3", "2026-07-01T12:00:00.000Z");

    const merged = mergeRoomMessages([mid, latest], [older, mid]);

    expect(merged.map((row) => row.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("keeps stream user above coworker when timestamps collide", () => {
    const sameInstant = "2026-07-01T12:00:00.000Z";
    const streamCoworker = coworkerMessage(
      "stream:aaa-assistant",
      sameInstant,
      "",
    );
    const streamUser = message(
      "stream:zzz-user",
      sameInstant,
      "Research our competitors",
    );

    // Assistant id sorts before user id lexicographically — must not win.
    const merged = mergeRoomMessages([], [streamCoworker, streamUser]);

    expect(merged.map((row) => row.id)).toEqual([
      "stream:zzz-user",
      "stream:aaa-assistant",
    ]);
  });
});

describe("mergeMessagesWithStreamOverlay", () => {
  it("appends overlay in array order after history", () => {
    const history = message("m1", "2026-07-01T10:00:00.000Z", "earlier");
    const streamUser = message(
      "stream:user",
      "2026-07-01T12:00:00.000Z",
      "Was ist deine Expertise?",
    );
    const streamAssistant = coworkerMessage(
      "stream:assistant",
      "2026-07-01T11:00:00.000Z",
      "I help with research.",
    );

    // Assistant timestamp is earlier than user — concat order must still win.
    const merged = mergeMessagesWithStreamOverlay(
      [history],
      [streamUser, streamAssistant],
    );

    expect(merged.map((row) => row.id)).toEqual([
      "m1",
      "stream:user",
      "stream:assistant",
    ]);
  });

  it("keeps empty stream coworker shell after user for waiting UX", () => {
    const persistedUser = message(
      "persisted-user",
      "2026-07-01T12:00:00.000Z",
      "Was ist deine Expertise?",
    );
    const streamUser = message(
      "stream:user",
      "2026-07-01T12:00:00.001Z",
      "Was ist deine Expertise?",
    );
    const emptyAssistant = coworkerMessage(
      "stream:assistant",
      "2026-07-01T12:00:00.000Z",
      "   ",
    );

    const merged = mergeMessagesWithStreamOverlay(
      [persistedUser],
      [streamUser, emptyAssistant],
    );

    expect(merged.map((row) => row.id)).toEqual([
      "stream:user",
      "stream:assistant",
    ]);
  });

  it("hides only one persisted user per overlay user with same content", () => {
    const olderSame = message(
      "persisted-older",
      "2026-07-01T11:00:00.000Z",
      "hello",
    );
    const newerSame = message(
      "persisted-newer",
      "2026-07-01T12:00:00.000Z",
      "hello",
    );
    const streamUser = message(
      "stream:user",
      "2026-07-01T12:00:00.001Z",
      "hello",
    );
    const streamAssistant = coworkerMessage(
      "stream:assistant",
      "2026-07-01T12:00:00.002Z",
      "hi",
    );

    const merged = mergeMessagesWithStreamOverlay(
      [olderSame, newerSame],
      [streamUser, streamAssistant],
    );

    // Prefer dropping the latest persisted match; keep the earlier duplicate.
    expect(merged.map((row) => row.id)).toEqual([
      "persisted-older",
      "stream:user",
      "stream:assistant",
    ]);
  });

  it("hides one persisted match per overlay occurrence of same content", () => {
    const first = message("p1", "2026-07-01T11:00:00.000Z", "ping");
    const second = message("p2", "2026-07-01T12:00:00.000Z", "ping");
    const overlayFirst = message(
      "stream:u1",
      "2026-07-01T12:00:01.000Z",
      "ping",
    );
    const overlaySecond = message(
      "stream:u2",
      "2026-07-01T12:00:02.000Z",
      "ping",
    );

    const merged = mergeMessagesWithStreamOverlay(
      [first, second],
      [overlayFirst, overlaySecond],
    );

    expect(merged.map((row) => row.id)).toEqual(["stream:u1", "stream:u2"]);
  });
});
