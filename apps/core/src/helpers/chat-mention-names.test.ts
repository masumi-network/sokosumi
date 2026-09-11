import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  userMemberFindManyMock,
  coworkerMemberFindManyMock,
  sokoBotMemberFindManyMock,
} = vi.hoisted(() => ({
  userMemberFindManyMock: vi.fn(),
  coworkerMemberFindManyMock: vi.fn(),
  sokoBotMemberFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomUserMember: { findMany: userMemberFindManyMock },
    chatRoomCoworkerMember: { findMany: coworkerMemberFindManyMock },
    chatRoomSokoBotMember: { findMany: sokoBotMemberFindManyMock },
  },
}));

import { loadChatMentionNames } from "./chat-mention-names";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const ADA_ID = "019fc7e4-e4bd-7005-900c-66e44d33f5e4";
const BEN_ID = "019fc7e4-e4bd-7005-900c-66e44d33f5e5";
const AUTH_USER_ID = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

function isPostgresUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  userMemberFindManyMock.mockResolvedValue([]);
  coworkerMemberFindManyMock.mockResolvedValue([]);
  sokoBotMemberFindManyMock.mockResolvedValue([]);
});

describe("loadChatMentionNames", () => {
  it("names the user a message mentions", async () => {
    userMemberFindManyMock.mockResolvedValue([
      { user: { id: ADA_ID, name: "Ada Lovelace" } },
    ]);

    const names = await loadChatMentionNames({
      roomId: ROOM_ID,
      content: `@${ADA_ID}:ada-lovelace can you take this one`,
    });

    expect(names.get(ADA_ID)).toBe("Ada Lovelace");
    expect(userMemberFindManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: { in: [ADA_ID] } },
      select: { user: { select: { id: true, name: true } } },
    });
  });

  it("names a coworker and a soko bot the same way", async () => {
    coworkerMemberFindManyMock.mockResolvedValue([
      { coworker: { id: ADA_ID, name: "Research Coworker" } },
    ]);
    sokoBotMemberFindManyMock.mockResolvedValue([
      { sokoBot: { id: BEN_ID, name: "Soko" } },
    ]);

    const names = await loadChatMentionNames({
      roomId: ROOM_ID,
      content: `@${ADA_ID}:research @${BEN_ID}:soko please`,
    });

    expect(names.get(ADA_ID)).toBe("Research Coworker");
    expect(names.get(BEN_ID)).toBe("Soko");
  });

  it("names a soko bot when the same message also mentions a non-uuid user", async () => {
    userMemberFindManyMock.mockResolvedValue([
      { user: { id: AUTH_USER_ID, name: "Ada Lovelace" } },
    ]);
    sokoBotMemberFindManyMock.mockImplementation(
      async (args: { where: { sokoBotId: { in: string[] } } }) => {
        for (const id of args.where.sokoBotId.in) {
          if (!isPostgresUuid(id)) {
            throw new Error(`invalid input syntax for type uuid: "${id}"`);
          }
        }
        return [{ sokoBot: { id: BEN_ID, name: "Soko" } }];
      },
    );

    const names = await loadChatMentionNames({
      roomId: ROOM_ID,
      content: `@${AUTH_USER_ID} @${BEN_ID}:soko please`,
    });

    expect(names.get(AUTH_USER_ID)).toBe("Ada Lovelace");
    expect(names.get(BEN_ID)).toBe("Soko");
    expect(userMemberFindManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: { in: [AUTH_USER_ID, BEN_ID] } },
      select: { user: { select: { id: true, name: true } } },
    });
    expect(coworkerMemberFindManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, coworkerId: { in: [AUTH_USER_ID, BEN_ID] } },
      select: { coworker: { select: { id: true, name: true } } },
    });
  });

  it("names an opaque user without querying soko bot members", async () => {
    userMemberFindManyMock.mockResolvedValue([
      { user: { id: AUTH_USER_ID, name: "Ada Lovelace" } },
    ]);

    const names = await loadChatMentionNames({
      roomId: ROOM_ID,
      content: `@${AUTH_USER_ID}`,
    });

    expect(names.get(AUTH_USER_ID)).toBe("Ada Lovelace");
    expect(sokoBotMemberFindManyMock).not.toHaveBeenCalled();
  });

  /** A room-wide mention names a room, so there is nobody to look up. */
  it("reads nobody for a room-wide mention", async () => {
    const names = await loadChatMentionNames({
      roomId: ROOM_ID,
      content: "@all:all standup in five",
    });

    expect(names.size).toBe(0);
    expect(userMemberFindManyMock).not.toHaveBeenCalled();
  });

  it("reads nothing at all for a message that mentions nobody", async () => {
    const names = await loadChatMentionNames({
      roomId: ROOM_ID,
      content: "ship it",
    });

    expect(names.size).toBe(0);
    expect(userMemberFindManyMock).not.toHaveBeenCalled();
    expect(coworkerMemberFindManyMock).not.toHaveBeenCalled();
    expect(sokoBotMemberFindManyMock).not.toHaveBeenCalled();
  });

  /** The token carries an id; whether it names a member of this room is the
   * room's answer, and a stranger simply goes unnamed. */
  it("leaves a mention unnamed when the key names nobody in the room", async () => {
    const names = await loadChatMentionNames({
      roomId: ROOM_ID,
      content: `@${ADA_ID}:ada hi`,
    });

    expect(names.size).toBe(0);
  });

  it("reads through the transaction client it is given", async () => {
    const txUserFindMany = vi
      .fn()
      .mockResolvedValue([{ user: { id: ADA_ID, name: "Ada Lovelace" } }]);
    const txClient = {
      chatRoomUserMember: { findMany: txUserFindMany },
      chatRoomCoworkerMember: { findMany: vi.fn().mockResolvedValue([]) },
      chatRoomSokoBotMember: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const names = await loadChatMentionNames({
      roomId: ROOM_ID,
      content: `@${ADA_ID}:ada hi`,
      client: txClient as never,
    });

    expect(names.get(ADA_ID)).toBe("Ada Lovelace");
    expect(txUserFindMany).toHaveBeenCalledTimes(1);
    expect(userMemberFindManyMock).not.toHaveBeenCalled();
  });
});
