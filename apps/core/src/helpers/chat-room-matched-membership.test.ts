import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureMatchedChannelParticipant,
  removeMatchedChannelParticipant,
} from "./chat-room-matched-membership";

const {
  userFindUniqueMock,
  roomFindUniqueMock,
  roomUserMemberFindUniqueMock,
  roomUserMemberCreateMock,
  roomUserMemberDeleteManyMock,
  readStateCreateManyMock,
  readStateDeleteManyMock,
  queryRawMock,
  executeRawMock,
  recordChannelMembershipStatusMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  roomFindUniqueMock: vi.fn(),
  roomUserMemberFindUniqueMock: vi.fn(),
  roomUserMemberCreateMock: vi.fn(),
  roomUserMemberDeleteManyMock: vi.fn(),
  readStateCreateManyMock: vi.fn(),
  readStateDeleteManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  executeRawMock: vi.fn(),
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
      deleteMany: roomUserMemberDeleteManyMock,
    },
    chatRoomReadState: {
      createMany: readStateCreateManyMock,
      deleteMany: readStateDeleteManyMock,
    },
    $queryRaw: queryRawMock,
    $executeRaw: executeRawMock,
  };
}

describe("ensureMatchedChannelParticipant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: USER_ID, name: "Ada" });
    queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
    executeRawMock.mockResolvedValue(0);
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

  it("treats a concurrent unique violation as already_member after savepoint rollback", async () => {
    roomUserMemberCreateMock.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    roomUserMemberFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ access: "member" });

    const { result, statusMessages } = await ensureMatchedChannelParticipant(
      tx() as never,
      { userId: USER_ID, roomId: ROOM_ID },
    );

    expect(result.outcome).toBe("already_member");
    expect(statusMessages).toEqual([]);
    expect(executeRawMock).toHaveBeenCalled();
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

describe("removeMatchedChannelParticipant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRawMock.mockResolvedValue([{ id: ROOM_ID }]);
    roomFindUniqueMock.mockResolvedValue(matchedRoom());
    roomUserMemberFindUniqueMock.mockResolvedValue({
      access: "member",
      user: { id: USER_ID, name: "Ada" },
    });
    roomUserMemberDeleteManyMock.mockResolvedValue({ count: 1 });
    readStateDeleteManyMock.mockResolvedValue({ count: 1 });
    recordChannelMembershipStatusMock.mockResolvedValue([{ id: "msg_left" }]);
  });

  it("deletes membership, read state, and records left status", async () => {
    const { result, statusMessages } = await removeMatchedChannelParticipant(
      tx() as never,
      { userId: USER_ID, roomId: ROOM_ID },
    );

    expect(result).toEqual({
      userId: USER_ID,
      roomId: ROOM_ID,
      roomName: "Matched",
      outcome: "removed",
    });
    expect(statusMessages).toEqual([{ id: "msg_left" }]);
    expect(roomUserMemberDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: USER_ID },
    });
    expect(readStateDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: USER_ID },
    });
    expect(recordChannelMembershipStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        changes: [
          expect.objectContaining({
            action: "left",
            subject: { type: "user", id: USER_ID, name: "Ada" },
          }),
        ],
      }),
    );
  });

  it("404s when the member is not on the roster", async () => {
    roomUserMemberFindUniqueMock.mockResolvedValue(null);

    await expect(
      removeMatchedChannelParticipant(tx() as never, {
        userId: USER_ID,
        roomId: ROOM_ID,
      }),
    ).rejects.toMatchObject({ message: "Room member not found" });
  });
});
