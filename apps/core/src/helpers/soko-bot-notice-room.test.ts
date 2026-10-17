import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  chatRoom,
  chatRoomUserMember,
  sokoBot,
  sokoBotTurn,
  findOrOpenOwnerDirectRoom,
} = vi.hoisted(() => ({
  chatRoom: { findFirst: vi.fn() },
  chatRoomUserMember: { findUnique: vi.fn() },
  sokoBot: { findFirst: vi.fn() },
  sokoBotTurn: { findFirst: vi.fn() },
  findOrOpenOwnerDirectRoom: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { chatRoom, chatRoomUserMember, sokoBot, sokoBotTurn },
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SokoBotValidationError: class SokoBotValidationError extends Error {},
}));
vi.mock("@/services/soko-bot-chat.service", () => ({
  findOrOpenOwnerDirectRoom,
}));

import {
  isOwnSharedRoom,
  needsProactiveDestination,
  resolveNoticeRoom,
  turnDestinationRoom,
  withNoticeMention,
} from "./soko-bot-notice-room";

const personal = {
  id: "bot",
  userId: "owner",
  workspaceId: "ws",
  sharedRoomId: null,
  workspace: { organizationId: "org" },
};
const shared = { ...personal, userId: null, sharedRoomId: "room-shared" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("isOwnSharedRoom", () => {
  it.each([
    ["a shared bot's own room", { userId: null, sharedRoomId: "room" }, true],
    ["another room", { userId: null, sharedRoomId: "other" }, false],
    ["a personal bot", { userId: "owner", sharedRoomId: "room" }, false],
  ])("is %s for %s", (_label, bot, expected) => {
    expect(isOwnSharedRoom(bot, "room")).toBe(expected);
  });
});

describe("needsProactiveDestination", () => {
  it.each([
    ["SCHEDULE", true],
    ["EVENT", true],
    ["INGEST", true],
    ["CHAT", false],
    ["ADMIN_RETRY", false],
  ])("%s gives %s", (source, expected) => {
    expect(needsProactiveDestination(source)).toBe(expected);
  });
});

describe("turnDestinationRoom", () => {
  it("speaks in a shared bot's own room for a self-started turn", async () => {
    chatRoom.findFirst.mockResolvedValueOnce({ id: "room-shared" });
    await expect(
      turnDestinationRoom(
        shared,
        { userId: "member", clientTurnId: "turn-key" },
        "SCHEDULE",
      ),
    ).resolves.toEqual({ id: "room-shared" });
    expect(chatRoom.findFirst).toHaveBeenCalledWith({
      where: {
        id: "room-shared",
        archivedAt: null,
        sokoBotMembers: { some: { sokoBotId: "bot" } },
      },
      select: { id: true },
    });
    expect(findOrOpenOwnerDirectRoom).not.toHaveBeenCalled();
  });

  it("still speaks in the shared room after the member left it", async () => {
    chatRoom.findFirst.mockResolvedValueOnce({ id: "room-shared" });
    chatRoomUserMember.findUnique.mockResolvedValueOnce(null);
    await expect(
      turnDestinationRoom(
        shared,
        { userId: "member", clientTurnId: "turn-key" },
        "EVENT",
      ),
    ).resolves.toEqual({ id: "room-shared" });
  });

  it("sends a shared bot's schedule run retry to its shared room", async () => {
    chatRoom.findFirst.mockResolvedValueOnce({ id: "room-shared" });
    await expect(
      turnDestinationRoom(
        shared,
        { userId: "member", clientTurnId: "admin-schedule-retry:run:op" },
        "ADMIN_RETRY",
      ),
    ).resolves.toEqual({ id: "room-shared" });
  });

  it("has nowhere to speak for a shared bot without a room", async () => {
    await expect(
      turnDestinationRoom(
        { ...shared, sharedRoomId: null },
        { userId: "member", clientTurnId: "turn-key" },
        "SCHEDULE",
      ),
    ).resolves.toBeNull();
    expect(chatRoom.findFirst).not.toHaveBeenCalled();
    expect(sokoBot.findFirst).not.toHaveBeenCalled();
  });

  describe("a shared bot's retry of one failed turn", () => {
    const retry = {
      userId: "member",
      clientTurnId: "admin-retry:failed-turn:op",
    };

    it("speaks in the shared room when the failed turn spoke there", async () => {
      sokoBotTurn.findFirst.mockResolvedValueOnce({
        destinationRoomId: "room-shared",
      });
      chatRoom.findFirst.mockResolvedValueOnce({ id: "room-shared" });
      await expect(
        turnDestinationRoom(shared, retry, "ADMIN_RETRY"),
      ).resolves.toEqual({ id: "room-shared" });
      expect(sokoBotTurn.findFirst).toHaveBeenCalledWith({
        where: { id: "failed-turn", sokoBotId: "bot" },
        select: { destinationRoomId: true },
      });
    });

    it("refuses a turn that spoke in another room", async () => {
      sokoBotTurn.findFirst.mockResolvedValueOnce({
        destinationRoomId: "private-channel",
      });
      await expect(
        turnDestinationRoom(shared, retry, "ADMIN_RETRY"),
      ).rejects.toThrow("spoke outside the shared Soko Bot's room");
      expect(chatRoom.findFirst).not.toHaveBeenCalled();
    });

    it("keeps no room for a turn that had none", async () => {
      sokoBotTurn.findFirst.mockResolvedValueOnce({ destinationRoomId: null });
      await expect(
        turnDestinationRoom(shared, retry, "ADMIN_RETRY"),
      ).resolves.toBeNull();
      expect(chatRoom.findFirst).not.toHaveBeenCalled();
    });
  });

  it("keeps a personal bot's retry in its owner's direct room", async () => {
    chatRoom.findFirst.mockResolvedValueOnce({ id: "room-direct" });
    await expect(
      turnDestinationRoom(
        personal,
        { userId: "owner", clientTurnId: "admin-retry:failed-turn:op" },
        "ADMIN_RETRY",
      ),
    ).resolves.toEqual({ id: "room-direct" });
    expect(sokoBotTurn.findFirst).not.toHaveBeenCalled();
  });

  it("gives a shared bot's console turn no room", async () => {
    await expect(
      turnDestinationRoom(
        shared,
        { userId: "member", clientTurnId: "turn-key" },
        "CHAT",
      ),
    ).resolves.toBeNull();
    expect(chatRoom.findFirst).not.toHaveBeenCalled();
  });

  it("keeps a personal bot in its owner's live direct room", async () => {
    chatRoom.findFirst.mockResolvedValueOnce({ id: "room-direct" });
    await expect(
      turnDestinationRoom(
        personal,
        { userId: "owner", clientTurnId: "turn-key" },
        "SCHEDULE",
      ),
    ).resolves.toEqual({ id: "room-direct" });
    expect(chatRoom.findFirst).toHaveBeenCalledWith({
      where: {
        kind: "direct",
        archivedAt: null,
        sokoBotMembers: { some: { sokoBotId: "bot" } },
        userMembers: { some: { userId: "owner" } },
      },
      select: { id: true },
    });
  });

  it("opens a personal bot's first direct room for a self-started turn", async () => {
    chatRoom.findFirst.mockResolvedValue(null);
    sokoBot.findFirst.mockResolvedValueOnce(personal);
    findOrOpenOwnerDirectRoom.mockResolvedValueOnce({ id: "room-new" });
    await expect(
      turnDestinationRoom(
        personal,
        { userId: "owner", clientTurnId: "turn-key" },
        "EVENT",
      ),
    ).resolves.toEqual({ id: "room-new" });
    expect(findOrOpenOwnerDirectRoom).toHaveBeenCalledWith(personal, "owner");
  });
});

describe("resolveNoticeRoom", () => {
  it("posts a shared bot's notice in its room naming the member", async () => {
    chatRoom.findFirst.mockResolvedValueOnce({ id: "room-shared" });
    chatRoomUserMember.findUnique.mockResolvedValueOnce({ userId: "member" });
    await expect(resolveNoticeRoom(shared, "member")).resolves.toEqual({
      id: "room-shared",
      mentionUserId: "member",
    });
    expect(findOrOpenOwnerDirectRoom).not.toHaveBeenCalled();
  });

  it("posts a shared bot's notice unmentioned once the member left the room", async () => {
    chatRoom.findFirst.mockResolvedValueOnce({ id: "room-shared" });
    chatRoomUserMember.findUnique.mockResolvedValueOnce(null);
    await expect(resolveNoticeRoom(shared, "member")).resolves.toEqual({
      id: "room-shared",
      mentionUserId: null,
    });
    expect(chatRoomUserMember.findUnique).toHaveBeenCalledWith({
      where: { roomId_userId: { roomId: "room-shared", userId: "member" } },
      select: { userId: true },
    });
  });

  it("posts nothing for a shared bot whose room is gone", async () => {
    chatRoom.findFirst.mockResolvedValueOnce(null);
    await expect(resolveNoticeRoom(shared, "member")).resolves.toBeNull();
    expect(findOrOpenOwnerDirectRoom).not.toHaveBeenCalled();
  });

  it("posts a personal bot's notice in its owner's direct room", async () => {
    findOrOpenOwnerDirectRoom.mockResolvedValueOnce({ id: "room-direct" });
    await expect(resolveNoticeRoom(personal, "someone")).resolves.toEqual({
      id: "room-direct",
      mentionUserId: null,
    });
    expect(findOrOpenOwnerDirectRoom).toHaveBeenCalledWith(personal, "owner");
  });
});

describe("withNoticeMention", () => {
  it("prefixes the member's mention token", () => {
    expect(withNoticeMention("Done.", "member")).toBe("@member Done.");
  });

  it("leaves a notice without a member as written", () => {
    expect(withNoticeMention("Done.", null)).toBe("Done.");
  });
});
