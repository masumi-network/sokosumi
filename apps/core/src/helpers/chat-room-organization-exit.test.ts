import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyOrganizationExitChatRevocation,
  listOrganizationExitChatRoomIdsForAbly,
  publishOrganizationExitChatRevocation,
} from "./chat-room-organization-exit";

const findManyMock = vi.fn();
const prismaFindManyMock = vi.fn();
const userFindUniqueMock = vi.fn();
const deleteManyMemberMock = vi.fn();
const deleteManyReadStateMock = vi.fn();
const groupByMock = vi.fn();
const chatRoomDeleteMock = vi.fn();
const chatRoomUpdateManyMock = vi.fn();
const guestInvitationUpdateManyMock = vi.fn();
const guestInviteLinkUpdateManyMock = vi.fn();
const recordChannelMembershipStatusMock = vi.fn();
const publishChatRoomMessageRealtimeMock = vi.fn();
const publishChatMembershipRevokedMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (callback: (tx: unknown) => unknown) =>
      transactionMock(callback),
    chatRoomUserMember: {
      findMany: (...args: unknown[]) => prismaFindManyMock(...args),
    },
  },
}));

vi.mock("@/routes/v1/chats/rooms/membership-status", () => ({
  recordChannelMembershipStatus: (...args: unknown[]) =>
    recordChannelMembershipStatusMock(...args),
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: (...args: unknown[]) =>
    publishChatRoomMessageRealtimeMock(...args),
}));

vi.mock("@/lib/ably/publish", () => ({
  publishChatMembershipRevoked: (...args: unknown[]) =>
    publishChatMembershipRevokedMock(...args),
}));

function createTx() {
  return {
    chatRoomUserMember: {
      findMany: findManyMock,
      deleteMany: deleteManyMemberMock,
      groupBy: groupByMock,
    },
    chatRoomReadState: {
      deleteMany: deleteManyReadStateMock,
    },
    user: {
      findUnique: userFindUniqueMock,
    },
    chatRoom: {
      delete: chatRoomDeleteMock,
      updateMany: chatRoomUpdateManyMock,
    },
    chatRoomGuestInvitation: {
      updateMany: guestInvitationUpdateManyMock,
    },
    chatRoomGuestInviteLink: {
      updateMany: guestInviteLinkUpdateManyMock,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findManyMock.mockResolvedValue([]);
  prismaFindManyMock.mockResolvedValue([]);
  userFindUniqueMock.mockResolvedValue({ name: "Ada" });
  deleteManyMemberMock.mockResolvedValue({ count: 0 });
  deleteManyReadStateMock.mockResolvedValue({ count: 0 });
  groupByMock.mockResolvedValue([]);
  chatRoomDeleteMock.mockResolvedValue({});
  chatRoomUpdateManyMock.mockResolvedValue({ count: 1 });
  guestInvitationUpdateManyMock.mockResolvedValue({ count: 0 });
  guestInviteLinkUpdateManyMock.mockResolvedValue({ count: 0 });
  recordChannelMembershipStatusMock.mockResolvedValue([{ id: "status-msg-1" }]);
  publishChatRoomMessageRealtimeMock.mockResolvedValue(undefined);
  publishChatMembershipRevokedMock.mockResolvedValue(undefined);
  transactionMock.mockImplementation(async (callback) => callback(createTx()));
});

describe("applyOrganizationExitChatRevocation", () => {
  it("no-ops when the user has no org room memberships", async () => {
    const result = await applyOrganizationExitChatRevocation(
      createTx() as never,
      "user_1",
      "org_1",
    );

    expect(result).toEqual({ revokedRoomIds: [], statusMessages: [] });
    expect(deleteManyMemberMock).not.toHaveBeenCalled();
    expect(recordChannelMembershipStatusMock).not.toHaveBeenCalled();
  });

  it("hard-leaves every org room: status, membership, read state, Ably inputs", async () => {
    findManyMock.mockResolvedValue([
      {
        roomId: "room-public",
        room: { id: "room-public", kind: "channel", archivedAt: null },
      },
      {
        roomId: "room-external",
        room: { id: "room-external", kind: "channel", archivedAt: null },
      },
      {
        roomId: "room-dm",
        room: { id: "room-dm", kind: "direct", archivedAt: null },
      },
    ]);
    // Other humans remain in public + external; DM becomes empty.
    groupByMock.mockResolvedValue([
      { roomId: "room-public", _count: { _all: 2 } },
      { roomId: "room-external", _count: { _all: 1 } },
    ]);

    const result = await applyOrganizationExitChatRevocation(
      createTx() as never,
      "user_1",
      "org_1",
    );

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        room: { organizationId: "org_1" },
      },
      select: {
        roomId: true,
        room: {
          select: {
            id: true,
            kind: true,
            archivedAt: true,
          },
        },
      },
    });

    expect(recordChannelMembershipStatusMock).toHaveBeenCalledTimes(2);
    expect(recordChannelMembershipStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        roomId: "room-public",
        roomKind: "channel",
        changes: [
          {
            action: "left",
            subject: { type: "user", id: "user_1", name: "Ada" },
          },
        ],
      },
    );
    expect(recordChannelMembershipStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        roomId: "room-external",
        roomKind: "channel",
        changes: [
          {
            action: "left",
            subject: { type: "user", id: "user_1", name: "Ada" },
          },
        ],
      },
    );

    expect(deleteManyMemberMock).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        roomId: {
          in: ["room-public", "room-external", "room-dm"],
        },
      },
    });
    expect(deleteManyReadStateMock).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        roomId: {
          in: ["room-public", "room-external", "room-dm"],
        },
      },
    });

    // Channel leave bumps room.updatedAt; empty direct is hard-deleted.
    expect(chatRoomUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["room-public", "room-external"] } },
      data: { updatedAt: expect.any(Date) },
    });
    expect(chatRoomDeleteMock).toHaveBeenCalledWith({
      where: { id: "room-dm" },
    });
    expect(guestInvitationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        roomId: { in: ["room-dm"] },
        status: "pending",
      },
      data: { status: "revoked" },
    });
    expect(guestInviteLinkUpdateManyMock).toHaveBeenCalledWith({
      where: {
        roomId: { in: ["room-dm"] },
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });

    expect(result.revokedRoomIds).toEqual([
      "room-public",
      "room-external",
      "room-dm",
    ]);
    expect(result.statusMessages).toHaveLength(2);
  });

  it("soft-archives channels left with zero human members and revokes invites", async () => {
    findManyMock.mockResolvedValue([
      {
        roomId: "room-solo",
        room: { id: "room-solo", kind: "channel", archivedAt: null },
      },
    ]);
    groupByMock.mockResolvedValue([]);

    await applyOrganizationExitChatRevocation(
      createTx() as never,
      "user_1",
      "org_1",
    );

    expect(guestInvitationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        roomId: { in: ["room-solo"] },
        status: "pending",
      },
      data: { status: "revoked" },
    });
    expect(guestInviteLinkUpdateManyMock).toHaveBeenCalledWith({
      where: {
        roomId: { in: ["room-solo"] },
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(chatRoomUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["room-solo"] } },
      data: { updatedAt: expect.any(Date) },
    });
    expect(chatRoomUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "room-solo", archivedAt: null },
      data: { archivedAt: expect.any(Date), updatedAt: expect.any(Date) },
    });
    expect(chatRoomDeleteMock).not.toHaveBeenCalled();
  });

  it("does not revoke invites when other humans remain in the room", async () => {
    findManyMock.mockResolvedValue([
      {
        roomId: "room-shared",
        room: { id: "room-shared", kind: "channel", archivedAt: null },
      },
    ]);
    groupByMock.mockResolvedValue([
      { roomId: "room-shared", _count: { _all: 2 } },
    ]);

    await applyOrganizationExitChatRevocation(
      createTx() as never,
      "user_1",
      "org_1",
    );

    expect(guestInvitationUpdateManyMock).not.toHaveBeenCalled();
    expect(guestInviteLinkUpdateManyMock).not.toHaveBeenCalled();
    expect(chatRoomUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["room-shared"] } },
      data: { updatedAt: expect.any(Date) },
    });
  });
  it("does not re-archive already archived empty channels", async () => {
    findManyMock.mockResolvedValue([
      {
        roomId: "room-archived",
        room: {
          id: "room-archived",
          kind: "channel",
          archivedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      },
    ]);
    groupByMock.mockResolvedValue([]);

    await applyOrganizationExitChatRevocation(
      createTx() as never,
      "user_1",
      "org_1",
    );

    // Activity bump for left status only — no second archive write.
    expect(chatRoomUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["room-archived"] } },
      data: { updatedAt: expect.any(Date) },
    });
    expect(chatRoomUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      }),
    );
  });

  it("falls back to Someone when the user has no display name", async () => {
    findManyMock.mockResolvedValue([
      {
        roomId: "room-1",
        room: { id: "room-1", kind: "channel", archivedAt: null },
      },
    ]);
    userFindUniqueMock.mockResolvedValue({ name: "   " });
    groupByMock.mockResolvedValue([{ roomId: "room-1", _count: { _all: 1 } }]);

    await applyOrganizationExitChatRevocation(
      createTx() as never,
      "user_1",
      "org_1",
    );

    expect(recordChannelMembershipStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        changes: [
          expect.objectContaining({
            subject: expect.objectContaining({ name: "Someone" }),
          }),
        ],
      }),
    );
  });
});

describe("publishOrganizationExitChatRevocation", () => {
  it("publishes left status messages and membership revokes", async () => {
    await publishOrganizationExitChatRevocation("user_1", {
      revokedRoomIds: ["room-a", "room-b"],
      statusMessages: [{ id: "m1" } as never, { id: "m2" } as never],
    });

    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledTimes(2);
    expect(publishChatMembershipRevokedMock).toHaveBeenCalledWith({
      userId: "user_1",
      roomId: "room-a",
      reason: "left",
    });
    expect(publishChatMembershipRevokedMock).toHaveBeenCalledWith({
      userId: "user_1",
      roomId: "room-b",
      reason: "left",
    });
  });

  it("swallows individual publish failures", async () => {
    publishChatMembershipRevokedMock
      .mockRejectedValueOnce(new Error("ably down"))
      .mockResolvedValueOnce(undefined);

    await expect(
      publishOrganizationExitChatRevocation("user_1", {
        revokedRoomIds: ["room-a", "room-b"],
        statusMessages: [],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("listOrganizationExitChatRoomIdsForAbly", () => {
  it("lists room ids without mutating chat", async () => {
    prismaFindManyMock.mockResolvedValue([
      { roomId: "room-a" },
      { roomId: "room-b" },
    ]);

    await expect(
      listOrganizationExitChatRoomIdsForAbly("user_1", "org_1"),
    ).resolves.toEqual(["room-a", "room-b"]);

    expect(prismaFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        room: { organizationId: "org_1" },
      },
      select: { roomId: true },
    });
    expect(deleteManyMemberMock).not.toHaveBeenCalled();
  });
});
