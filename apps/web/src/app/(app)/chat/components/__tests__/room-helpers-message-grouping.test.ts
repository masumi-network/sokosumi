import { describe, expect, it } from "vitest";

import type { ChatRoomMessage } from "@/lib/clients/generated/core";

import {
  isMessageContinuation,
  MESSAGE_GROUP_GAP_MS,
  messageSenderKey,
} from "../room-helpers";

function baseMessage(
  overrides: Partial<ChatRoomMessage> &
    Pick<ChatRoomMessage, "id" | "createdAt" | "sender">,
): ChatRoomMessage {
  return {
    roomId: "room-1",
    parentMessageId: null,
    content: "hi",
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    ...overrides,
  };
}

function userMessage(
  id: string,
  createdAt: string,
  userId = "user-1",
): ChatRoomMessage {
  return baseMessage({
    id,
    createdAt: new Date(createdAt),
    sender: {
      type: "user",
      user: {
        id: userId,
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
      },
    },
  });
}

function coworkerMessage(
  id: string,
  createdAt: string,
  coworkerId = "cow-1",
): ChatRoomMessage {
  return baseMessage({
    id,
    createdAt: new Date(createdAt),
    sender: {
      type: "coworker",
      coworker: {
        id: coworkerId,
        name: "Jamal",
        slug: "jamal",
        caption: null,
        image: null,
        presence: "online",
      },
    },
  });
}

function unknownMessage(id: string, createdAt: string): ChatRoomMessage {
  return baseMessage({
    id,
    createdAt: new Date(createdAt),
    sender: { type: "unknown" },
  });
}

describe("messageSenderKey", () => {
  it("keys users and coworkers by type and id", () => {
    expect(
      messageSenderKey(userMessage("m1", "2026-07-01T12:00:00.000Z")),
    ).toBe("user:user-1");
    expect(
      messageSenderKey(coworkerMessage("m2", "2026-07-01T12:00:00.000Z")),
    ).toBe("coworker:cow-1");
  });

  it("returns null for unknown senders", () => {
    expect(
      messageSenderKey(unknownMessage("m3", "2026-07-01T12:00:00.000Z")),
    ).toBeNull();
  });
});

describe("isMessageContinuation", () => {
  it("is false when there is no previous message", () => {
    expect(
      isMessageContinuation(
        undefined,
        userMessage("m1", "2026-07-01T12:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("is true for same sender within the gap on the same day", () => {
    const previous = userMessage("m1", "2026-07-01T12:00:00.000Z");
    const current = userMessage("m2", "2026-07-01T12:04:00.000Z");
    expect(isMessageContinuation(previous, current)).toBe(true);
  });

  it("is false when sender identity differs even if display names match", () => {
    const previous = userMessage("m1", "2026-07-01T12:00:00.000Z", "user-1");
    const current = userMessage("m2", "2026-07-01T12:01:00.000Z", "user-2");
    expect(isMessageContinuation(previous, current)).toBe(false);
  });

  it("is false across user vs coworker even with close timestamps", () => {
    const previous = userMessage("m1", "2026-07-01T12:00:00.000Z");
    const current = coworkerMessage("m2", "2026-07-01T12:01:00.000Z");
    expect(isMessageContinuation(previous, current)).toBe(false);
  });

  it("is false when the time gap is at or beyond the default threshold", () => {
    const previous = userMessage("m1", "2026-07-01T12:00:00.000Z");
    const atGap = userMessage(
      "m2",
      new Date(
        new Date("2026-07-01T12:00:00.000Z").getTime() + MESSAGE_GROUP_GAP_MS,
      ).toISOString(),
    );
    const beyondGap = userMessage(
      "m3",
      new Date(
        new Date("2026-07-01T12:00:00.000Z").getTime() +
          MESSAGE_GROUP_GAP_MS +
          1,
      ).toISOString(),
    );
    expect(isMessageContinuation(previous, atGap)).toBe(false);
    expect(isMessageContinuation(previous, beyondGap)).toBe(false);
  });

  it("is false when the current timestamp precedes the previous message", () => {
    const previous = userMessage("m1", "2026-07-01T12:04:00.000Z");
    const current = userMessage("m2", "2026-07-01T12:00:00.000Z");

    expect(isMessageContinuation(previous, current)).toBe(false);
  });

  it("is false across day boundaries even within the gap", () => {
    const previous = userMessage(
      "m1",
      new Date(2026, 6, 1, 23, 58, 0).toISOString(),
    );
    const current = userMessage(
      "m2",
      new Date(2026, 6, 2, 0, 1, 0).toISOString(),
    );
    expect(isMessageContinuation(previous, current)).toBe(false);
  });

  it("never continues unknown senders", () => {
    const previous = unknownMessage("m1", "2026-07-01T12:00:00.000Z");
    const current = unknownMessage("m2", "2026-07-01T12:01:00.000Z");
    expect(isMessageContinuation(previous, current)).toBe(false);
  });

  it("honors a custom gapMs option", () => {
    const previous = userMessage("m1", "2026-07-01T12:00:00.000Z");
    const current = userMessage("m2", "2026-07-01T12:02:00.000Z");
    expect(isMessageContinuation(previous, current, { gapMs: 60_000 })).toBe(
      false,
    );
    expect(isMessageContinuation(previous, current, { gapMs: 180_000 })).toBe(
      true,
    );
  });
});
