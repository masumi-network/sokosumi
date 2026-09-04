import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertChatRoomContentMessage,
  diffChannelMembershipRoster,
  readMembershipFromMetadata,
  recordChannelMembershipStatus,
} from "./membership-status";

const messageCreateMock = vi.fn();

const tx = {
  chatRoomMessage: {
    create: messageCreateMock,
  },
};

function statusMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440099",
    roomId: "550e8400-e29b-41d4-a716-446655440000",
    parentMessageId: null,
    senderUserId: null,
    senderCoworkerId: null,
    content: "Ada joined",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    editedAt: null,
    metadata: {
      membership: {
        action: "joined",
        subject: { type: "user", id: "user_ada", name: "Ada" },
      },
    },
    clientMessageId: null,
    responsesApiResponseId: null,
    senderUser: null,
    senderCoworker: null,
    mentionsAsSource: [],
    reactions: [],
    replies: [],
    _count: { replies: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  messageCreateMock.mockResolvedValue(statusMessage());
});

describe("diffChannelMembershipRoster", () => {
  it("emits joined/left for user and coworker adds and removes", () => {
    const changes = diffChannelMembershipRoster({
      prior: {
        users: [
          { id: "user_a", name: "Ada" },
          { id: "user_b", name: "Bob" },
        ],
        coworkers: [{ id: "cow_old", name: "OldBot" }],
      },
      next: {
        users: [
          { id: "user_a", name: "Ada" },
          { id: "user_c", name: "Carol" },
        ],
        coworkers: [{ id: "cow_new", name: "NewBot" }],
      },
    });

    expect(changes).toEqual([
      {
        action: "left",
        subject: { type: "user", id: "user_b", name: "Bob" },
      },
      {
        action: "left",
        subject: { type: "coworker", id: "cow_old", name: "OldBot" },
      },
      {
        action: "joined",
        subject: { type: "user", id: "user_c", name: "Carol" },
      },
      {
        action: "joined",
        subject: { type: "coworker", id: "cow_new", name: "NewBot" },
      },
    ]);
  });

  it("returns empty when roster is unchanged", () => {
    const roster = {
      users: [{ id: "user_a", name: "Ada" }],
      coworkers: [{ id: "cow_1", name: "Bot" }],
    };
    expect(
      diffChannelMembershipRoster({ prior: roster, next: roster }),
    ).toEqual([]);
  });
});

describe("recordChannelMembershipStatus", () => {
  it("creates null-sender messages with membership metadata and English content", async () => {
    const created = await recordChannelMembershipStatus(tx as never, {
      roomId: "550e8400-e29b-41d4-a716-446655440000",
      roomKind: "channel",
      changes: [
        {
          action: "joined",
          subject: { type: "user", id: "user_ada", name: "Ada" },
        },
        {
          action: "left",
          subject: { type: "coworker", id: "cow_1", name: "Bot" },
        },
      ],
    });

    expect(messageCreateMock).toHaveBeenCalledTimes(2);
    expect(messageCreateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: {
          roomId: "550e8400-e29b-41d4-a716-446655440000",
          content: "Ada joined",
          senderUserId: null,
          senderCoworkerId: null,
          metadata: {
            membership: {
              action: "joined",
              subject: { type: "user", id: "user_ada", name: "Ada" },
            },
          },
        },
      }),
    );
    expect(messageCreateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          content: "Bot left",
          metadata: {
            membership: {
              action: "left",
              subject: { type: "coworker", id: "cow_1", name: "Bot" },
            },
          },
        }),
      }),
    );
    expect(created).toHaveLength(2);
  });

  it("no-ops for directs and empty changes", async () => {
    expect(
      await recordChannelMembershipStatus(tx as never, {
        roomId: "550e8400-e29b-41d4-a716-446655440000",
        roomKind: "direct",
        changes: [
          {
            action: "joined",
            subject: { type: "user", id: "user_ada", name: "Ada" },
          },
        ],
      }),
    ).toEqual([]);
    expect(
      await recordChannelMembershipStatus(tx as never, {
        roomId: "550e8400-e29b-41d4-a716-446655440000",
        roomKind: "channel",
        changes: [],
      }),
    ).toEqual([]);
    expect(messageCreateMock).not.toHaveBeenCalled();
  });
});

describe("readMembershipFromMetadata", () => {
  it("soft-parses a valid membership snapshot", () => {
    expect(
      readMembershipFromMetadata({
        membership: {
          action: "left",
          subject: { type: "coworker", id: "cow_1", name: "Bot" },
        },
      }),
    ).toEqual({
      action: "left",
      subject: { type: "coworker", id: "cow_1", name: "Bot" },
    });
  });

  it("normalizes a stored orchestrator subject to sokoBot", () => {
    expect(
      readMembershipFromMetadata({
        membership: {
          action: "joined",
          subject: {
            type: "orchestrator",
            id: "bot_1",
            name: "Jarvis",
          },
        },
      }),
    ).toEqual({
      action: "joined",
      subject: { type: "sokoBot", id: "bot_1", name: "Jarvis" },
    });
  });

  it("returns null for malformed membership", () => {
    expect(
      readMembershipFromMetadata({ membership: { action: "joined" } }),
    ).toBeNull();
    expect(readMembershipFromMetadata(null)).toBeNull();
    expect(readMembershipFromMetadata({})).toBeNull();
  });
});

describe("assertChatRoomContentMessage", () => {
  it("rejects membership status messages", () => {
    expect(() =>
      assertChatRoomContentMessage({
        membership: {
          action: "joined",
          subject: { type: "user", id: "u1", name: "Ada" },
        },
      }),
    ).toThrow(/membership status/i);
  });

  it("allows ordinary messages", () => {
    expect(() =>
      assertChatRoomContentMessage({ quote: { messageId: "x" } }),
    ).not.toThrow();
    expect(() => assertChatRoomContentMessage(null)).not.toThrow();
  });
});
