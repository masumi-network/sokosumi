import { describe, expect, it } from "vitest";

import type {
  ChatRoomMessage,
  ChatRoomMessageReaction,
} from "@/lib/clients/generated/core";

import {
  applyPendingReaction,
  mergeConfirmedReaction,
  overlayPendingReactions,
  pendingReactionKey,
} from "./pending-reactions";

const VIEWER = { id: "user-me", name: "Ada" };

function message(reactions: ChatRoomMessageReaction[] = []): ChatRoomMessage {
  return {
    id: "m1",
    roomId: "room-1",
    parentMessageId: null,
    content: "hello",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    editedAt: null,
    pinnedAt: null,
    sender: {
      type: "user",
      user: {
        id: "user-other",
        name: "Grace",
        email: "grace@example.com",
        image: null,
        presence: "offline",
      },
    },
    mentions: [],
    reactions,
    threadReplyCount: 0,
    threadLastReplyAt: null,
    metadata: null,
    quote: null,
    membership: null,
    groupNameChange: null,
    unfurls: null,
    deletedAt: null,
  };
}

function reaction(
  emoji: string,
  reactors: Array<{ id: string; name: string }>,
  overrides: Partial<ChatRoomMessageReaction> = {},
): ChatRoomMessageReaction {
  return {
    emoji,
    count: reactors.length,
    reactedByCurrentUser: reactors.some((reactor) => reactor.id === VIEWER.id),
    reactors,
    ...overrides,
  };
}

describe("applyPendingReaction", () => {
  it("adds a new entry with the viewer as its only reactor", () => {
    const result = applyPendingReaction(
      message([reaction("❤️", [{ id: "u2", name: "Bob" }])]),
      { messageId: "m1", emoji: "👍", reacted: true },
      VIEWER,
    );

    expect(result.reactions).toEqual([
      reaction("❤️", [{ id: "u2", name: "Bob" }]),
      { emoji: "👍", count: 1, reactedByCurrentUser: true, reactors: [VIEWER] },
    ]);
  });

  it("joins an existing entry at the end of the reactor list", () => {
    const result = applyPendingReaction(
      message([reaction("👍", [{ id: "u2", name: "Bob" }])]),
      { messageId: "m1", emoji: "👍", reacted: true },
      VIEWER,
    );

    expect(result.reactions).toEqual([
      {
        emoji: "👍",
        count: 2,
        reactedByCurrentUser: true,
        reactors: [{ id: "u2", name: "Bob" }, VIEWER],
      },
    ]);
  });

  it("keeps the capped reactor list when joining a crowded entry", () => {
    const crowd = Array.from({ length: 20 }, (_, index) => ({
      id: `u${index}`,
      name: `User ${index}`,
    }));
    const result = applyPendingReaction(
      message([reaction("👍", crowd, { count: 25 })]),
      { messageId: "m1", emoji: "👍", reacted: true },
      VIEWER,
    );

    expect(result.reactions[0]).toEqual({
      emoji: "👍",
      count: 26,
      reactedByCurrentUser: true,
      reactors: crowd,
    });
  });

  it("returns the same message when the intent already holds", () => {
    const reacted = message([reaction("👍", [VIEWER])]);
    const absent = message([]);

    expect(
      applyPendingReaction(
        reacted,
        { messageId: "m1", emoji: "👍", reacted: true },
        VIEWER,
      ),
    ).toBe(reacted);
    expect(
      applyPendingReaction(
        absent,
        { messageId: "m1", emoji: "👍", reacted: false },
        VIEWER,
      ),
    ).toBe(absent);
  });

  it("removes the viewer and drops an entry that reaches zero", () => {
    const result = applyPendingReaction(
      message([
        reaction("👍", [VIEWER]),
        reaction("❤️", [{ id: "u2", name: "Bob" }, VIEWER]),
      ]),
      { messageId: "m1", emoji: "👍", reacted: false },
      VIEWER,
    );

    expect(result.reactions).toEqual([
      reaction("❤️", [{ id: "u2", name: "Bob" }, VIEWER]),
    ]);
  });

  it("removes the viewer from a shared entry", () => {
    const result = applyPendingReaction(
      message([reaction("❤️", [{ id: "u2", name: "Bob" }, VIEWER])]),
      { messageId: "m1", emoji: "❤️", reacted: false },
      VIEWER,
    );

    expect(result.reactions).toEqual([
      reaction("❤️", [{ id: "u2", name: "Bob" }]),
    ]);
  });

  it("removes a viewer who reacted beyond the listed reactors", () => {
    const result = applyPendingReaction(
      message([
        reaction("👍", [{ id: "u2", name: "Bob" }], {
          count: 30,
          reactedByCurrentUser: true,
        }),
      ]),
      { messageId: "m1", emoji: "👍", reacted: false },
      VIEWER,
    );

    expect(result.reactions).toEqual([
      reaction("👍", [{ id: "u2", name: "Bob" }], { count: 29 }),
    ]);
  });

  it("updates count and highlight without a name when the viewer is unknown", () => {
    const result = applyPendingReaction(
      message([]),
      { messageId: "m1", emoji: "👍", reacted: true },
      { id: VIEWER.id, name: null },
    );

    expect(result.reactions).toEqual([
      { emoji: "👍", count: 1, reactedByCurrentUser: true, reactors: [] },
    ]);
  });
});

describe("overlayPendingReactions", () => {
  it("applies only the intents for this message and keeps identity otherwise", () => {
    const row = message([]);
    const pending = new Map([
      [
        pendingReactionKey("m1", "👍"),
        { messageId: "m1", emoji: "👍", reacted: true },
      ],
      [
        pendingReactionKey("m2", "❤️"),
        { messageId: "m2", emoji: "❤️", reacted: true },
      ],
    ]);

    const result = overlayPendingReactions(row, pending, VIEWER);
    expect(result.reactions.map((entry) => entry.emoji)).toEqual(["👍"]);
    expect(overlayPendingReactions(row, new Map(), VIEWER)).toBe(row);
  });
});

describe("mergeConfirmedReaction", () => {
  it("takes only the requested emoji from the response", () => {
    const existing = {
      ...message([
        reaction("👍", [{ id: "u2", name: "Bob" }]),
        reaction("🎉", [{ id: "u3", name: "Cy" }]),
      ]),
      content: "edited meanwhile",
    };
    const response = message([
      reaction("👍", [{ id: "u2", name: "Bob" }, VIEWER]),
      reaction("❤️", [{ id: "u4", name: "Di" }]),
    ]);

    const result = mergeConfirmedReaction(existing, response, "👍");

    expect(result.content).toBe("edited meanwhile");
    expect(result.reactions).toEqual([
      reaction("👍", [{ id: "u2", name: "Bob" }, VIEWER]),
      reaction("🎉", [{ id: "u3", name: "Cy" }]),
    ]);
  });

  it("appends a new entry and drops one the response no longer has", () => {
    const existing = message([reaction("👍", [VIEWER])]);

    expect(
      mergeConfirmedReaction(existing, message([]), "👍").reactions,
    ).toEqual([]);
    expect(
      mergeConfirmedReaction(
        message([]),
        message([reaction("❤️", [VIEWER])]),
        "❤️",
      ).reactions,
    ).toEqual([reaction("❤️", [VIEWER])]);
  });
});
