import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  memberFindManyMock,
  mentionCreateManyMock,
  messageFindUniqueMock,
  emitChatMentionNotificationsMock,
  captureExceptionMock,
} = vi.hoisted(() => ({
  memberFindManyMock: vi.fn(),
  mentionCreateManyMock: vi.fn(),
  messageFindUniqueMock: vi.fn(),
  emitChatMentionNotificationsMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMessage: { findUnique: messageFindUniqueMock },
  },
}));

vi.mock("@/helpers/chat-mention-notifications", () => ({
  emitChatMentionNotifications: (...args: unknown[]) =>
    emitChatMentionNotificationsMock(...args),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import {
  chatMentionRoomShape,
  emitChatHumanMentionNotifications,
  persistChatHumanMentions,
} from "./chat-human-mentions";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440002";
const ALICE_ID = "user_alice";
const BOB_ID = "user_bob";

const tx = {
  chatRoomUserMember: { findMany: memberFindManyMock },
  chatRoomUserMention: { createMany: mentionCreateManyMock },
};

beforeEach(() => {
  vi.clearAllMocks();
  memberFindManyMock.mockResolvedValue([
    { userId: ALICE_ID, user: { name: "Alice Adams" } },
    { userId: BOB_ID, user: { name: "Bob" } },
  ]);
  mentionCreateManyMock.mockResolvedValue({ count: 1 });
  emitChatMentionNotificationsMock.mockResolvedValue(undefined);
});

describe("persistChatHumanMentions", () => {
  it("writes one row per room member the body names, by id or by name", async () => {
    const mentioned = await persistChatHumanMentions(tx, {
      messageId: MESSAGE_ID,
      roomId: ROOM_ID,
      content: `@${ALICE_ID} and @bob please check`,
    });

    expect(memberFindManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID },
      select: { userId: true, user: { select: { name: true } } },
    });
    expect(mentioned).toEqual([ALICE_ID, BOB_ID]);
    expect(mentionCreateManyMock).toHaveBeenCalledWith({
      data: [
        { messageId: MESSAGE_ID, userId: ALICE_ID },
        { messageId: MESSAGE_ID, userId: BOB_ID },
      ],
      skipDuplicates: true,
    });
  });

  it("names everyone in the room on @all, the author's owner included", async () => {
    const mentioned = await persistChatHumanMentions(tx, {
      messageId: MESSAGE_ID,
      roomId: ROOM_ID,
      content: "@all stand-up in five",
    });

    expect(mentioned).toEqual([ALICE_ID, BOB_ID]);
  });

  it("writes nothing when the body names nobody in the room", async () => {
    const mentioned = await persistChatHumanMentions(tx, {
      messageId: MESSAGE_ID,
      roomId: ROOM_ID,
      content: "@user_outside and @carol are not here",
    });

    expect(mentioned).toEqual([]);
    expect(mentionCreateManyMock).not.toHaveBeenCalled();
  });

  it("skips an id that is not a member of the room", async () => {
    const mentioned = await persistChatHumanMentions(tx, {
      messageId: MESSAGE_ID,
      roomId: ROOM_ID,
      content: `@user_outside and @${ALICE_ID}`,
    });

    expect(mentioned).toEqual([ALICE_ID]);
    expect(mentionCreateManyMock).toHaveBeenCalledWith({
      data: [{ messageId: MESSAGE_ID, userId: ALICE_ID }],
      skipDuplicates: true,
    });
  });

  it("lets a retried fill skip the rows it already wrote", async () => {
    const params = {
      messageId: MESSAGE_ID,
      roomId: ROOM_ID,
      content: `@${ALICE_ID} again`,
    };

    await persistChatHumanMentions(tx, params);
    await persistChatHumanMentions(tx, params);

    expect(mentionCreateManyMock).toHaveBeenCalledTimes(2);
    for (const call of mentionCreateManyMock.mock.calls) {
      expect(call[0]).toMatchObject({ skipDuplicates: true });
    }
  });
});

describe("chatMentionRoomShape", () => {
  it("is a channel for anything that is not a direct room", () => {
    expect(
      chatMentionRoomShape({
        kind: "channel",
        memberUserIds: [ALICE_ID, BOB_ID],
        nonHumanMemberCount: 0,
      }),
    ).toBe("channel");
  });

  it("is a pair for a direct room of two humans and nobody else", () => {
    expect(
      chatMentionRoomShape({
        kind: "direct",
        memberUserIds: [ALICE_ID, BOB_ID],
        nonHumanMemberCount: 0,
      }),
    ).toBe("pair");
  });

  it("is a group for a direct room with a third human or an assistant", () => {
    expect(
      chatMentionRoomShape({
        kind: "direct",
        memberUserIds: [ALICE_ID, BOB_ID, "user_carol"],
        nonHumanMemberCount: 0,
      }),
    ).toBe("group");
    expect(
      chatMentionRoomShape({
        kind: "direct",
        memberUserIds: [ALICE_ID, BOB_ID],
        nonHumanMemberCount: 1,
      }),
    ).toBe("group");
  });
});

describe("emitChatHumanMentionNotifications", () => {
  function storedMessage(overrides: Record<string, unknown> = {}) {
    return {
      content: `@${ALICE_ID} please check`,
      senderCoworker: null,
      senderSokoBot: { name: "Eve" },
      room: {
        id: ROOM_ID,
        name: "Ada and Eve",
        organizationId: "org_1",
        kind: "direct",
        userMembers: [{ userId: ALICE_ID }, { userId: BOB_ID }],
        _count: { coworkerMembers: 0, sokoBotMembers: 1 },
      },
      ...overrides,
    };
  }

  it("emits under the Soko Bot's display name with no human author", async () => {
    messageFindUniqueMock.mockResolvedValue(storedMessage());

    await emitChatHumanMentionNotifications({
      messageId: MESSAGE_ID,
      mentionedUserIds: [ALICE_ID],
    });

    expect(emitChatMentionNotificationsMock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      roomName: "Ada and Eve",
      roomShape: "group",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      content: `@${ALICE_ID} please check`,
      authorUserId: null,
      authorName: "Eve",
      mentionedUserIds: [ALICE_ID],
    });
  });

  it("names an unnamed Soko Bot and a Coworker by their own rules", async () => {
    messageFindUniqueMock.mockResolvedValueOnce(
      storedMessage({ senderSokoBot: { name: null } }),
    );
    await emitChatHumanMentionNotifications({
      messageId: MESSAGE_ID,
      mentionedUserIds: [ALICE_ID],
    });
    expect(emitChatMentionNotificationsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ authorName: "Soko Bot" }),
    );

    messageFindUniqueMock.mockResolvedValueOnce(
      storedMessage({
        senderSokoBot: null,
        senderCoworker: { name: "Hannah" },
      }),
    );
    await emitChatHumanMentionNotifications({
      messageId: MESSAGE_ID,
      mentionedUserIds: [ALICE_ID],
    });
    expect(emitChatMentionNotificationsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ authorName: "Hannah" }),
    );
  });

  it("does nothing when nobody was mentioned or the message is gone", async () => {
    await emitChatHumanMentionNotifications({
      messageId: MESSAGE_ID,
      mentionedUserIds: [],
    });
    expect(messageFindUniqueMock).not.toHaveBeenCalled();

    messageFindUniqueMock.mockResolvedValue(null);
    await emitChatHumanMentionNotifications({
      messageId: MESSAGE_ID,
      mentionedUserIds: [ALICE_ID],
    });
    expect(emitChatMentionNotificationsMock).not.toHaveBeenCalled();
  });

  it("reports a failed read instead of rejecting", async () => {
    const error = new Error("connection reset");
    messageFindUniqueMock.mockRejectedValue(error);

    await expect(
      emitChatHumanMentionNotifications({
        messageId: MESSAGE_ID,
        mentionedUserIds: [ALICE_ID],
      }),
    ).resolves.toBeUndefined();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        tags: { context: "chat_mention_notifications" },
      }),
    );
  });
});
