import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureMatchedChannelParticipant } from "./chat-room-matched-membership";

const {
  userFindUniqueMock,
  roomFindUniqueMock,
  roomUserMemberFindUniqueMock,
  roomUserMemberCreateMock,
  readStateCreateManyMock,
  queryRawMock,
  recordChannelMembershipStatusMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  roomFindUniqueMock: vi.fn(),
  roomUserMemberFindUniqueMock: vi.fn(),
  roomUserMemberCreateMock: vi.fn(),
  readStateCreateManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  recordChannelMembershipStatusMock: vi.fn(),
}));

vi.mock("@/routes/v1/chats/rooms/membership-status", () => ({
  recordChannelMembershipStatus: (...args: unknown[]) =>
    recordChannelMembershipStatusMock(...args),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_1";

function matchedRoom() {
  return {
    id: ROOM_ID,
    name: "Matched",
    kind: "channel",
    discoverability: "matched",
    archivedAt: null,
    organizationId: null,
  };
}

function tx() {
  return {
    user: { findUnique: userFindUniqueMock },
    chatRoom: { findUnique: roomFindUniqueMock },
    chatRoomUserMember: {
      findUnique: roomUserMemberFindUniqueMock,
      create: roomUserMemberCreateMock,
    },
    chatRoomReadState: { createMany: readStateCreateManyMock },
    $queryRaw: queryRawMock,
  };
}

describe("ensureMatchedChannelParticipant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: USER_ID, name: "Ada" });
    queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
    roomFindUniqueMock.mockResolvedValue(matchedRoom());
    roomUserMemberFindUniqueMock.mockResolvedValue(null);
    roomUserMemberCreateMock.mockResolvedValue({});
    readStateCreateManyMock.mockResolvedValue({ count: 1 });
    recordChannelMembershipStatusMock.mockResolvedValue([{ id: "msg_1" }]);
  });

  it("creates member access, read state, and joined status on a live matched room", async () => {
    const { result, statusMessages } = await ensureMatchedChannelParticipant(
      tx() as never,
      { userId: USER_ID, roomId: ROOM_ID },
    );

    expect(result).toEqual({
      userId: USER_ID,
      roomId: ROOM_ID,
      roomName: "Matched",
      access: "member",
      outcome: "joined",
    });
    expect(statusMessages).toEqual([{ id: "msg_1" }]);
    expect(roomUserMemberCreateMock).toHaveBeenCalledWith({
      data: {
        roomId: ROOM_ID,
        userId: USER_ID,
        access: "member",
      },
    });
    expect(readStateCreateManyMock).toHaveBeenCalledWith({
      data: [{ roomId: ROOM_ID, userId: USER_ID }],
      skipDuplicates: true,
    });
    expect(recordChannelMembershipStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        roomId: ROOM_ID,
        changes: [
          expect.objectContaining({
            action: "joined",
            subject: { type: "user", id: USER_ID, name: "Ada" },
          }),
        ],
      }),
    );
  });

  it("is idempotent when already a member", async () => {
    roomUserMemberFindUniqueMock.mockResolvedValue({ access: "member" });

    const { result, statusMessages } = await ensureMatchedChannelParticipant(
      tx() as never,
      { userId: USER_ID, roomId: ROOM_ID },
    );

    expect(result.outcome).toBe("already_member");
    expect(statusMessages).toEqual([]);
    expect(roomUserMemberCreateMock).not.toHaveBeenCalled();
    expect(recordChannelMembershipStatusMock).not.toHaveBeenCalled();
  });

  it("rejects rooms that are not live matched channels", async () => {
    roomFindUniqueMock.mockResolvedValue({
      ...matchedRoom(),
      discoverability: "external",
      organizationId: "org_1",
    });

    await expect(
      ensureMatchedChannelParticipant(tx() as never, {
        userId: USER_ID,
        roomId: ROOM_ID,
      }),
    ).rejects.toMatchObject({
      message: "Room is not a live matched channel.",
    });
  });

  it("rejects when the user does not exist", async () => {
    userFindUniqueMock.mockResolvedValue(null);

    await expect(
      ensureMatchedChannelParticipant(tx() as never, {
        userId: USER_ID,
        roomId: ROOM_ID,
      }),
    ).rejects.toMatchObject({ message: "User not found" });
  });
});
