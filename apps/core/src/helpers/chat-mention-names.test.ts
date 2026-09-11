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
/** A member who signed up before Better Auth issued uuid ids. */
const LEGACY_AUTH_ID = "Xk3mQp7RvT2yLb9Nc4Wd8Hf6Jg1Zs5Aq";

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

  /**
   * `sokoBotId` is a `uuid` column, so Postgres rejects a legacy auth id
   * outright rather than matching nothing. That throw reaches the
   * notification fan-out before it has written anybody a row, which costs
   * every recipient of the message their notification.
   */
  it("keeps a legacy auth id out of the soko bot lookup", async () => {
    await loadChatMentionNames({
      roomId: ROOM_ID,
      content: `@${LEGACY_AUTH_ID} and @${BEN_ID} please`,
    });

    expect(sokoBotMemberFindManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, sokoBotId: { in: [BEN_ID] } },
      select: { sokoBot: { select: { id: true, name: true } } },
    });
  });

  it("skips the soko bot lookup when no key is a uuid", async () => {
    await loadChatMentionNames({
      roomId: ROOM_ID,
      content: `@${LEGACY_AUTH_ID} please`,
    });

    expect(sokoBotMemberFindManyMock).not.toHaveBeenCalled();
  });

  it("still names a member carrying a legacy auth id", async () => {
    userMemberFindManyMock.mockResolvedValue([
      { user: { id: LEGACY_AUTH_ID, name: "Ada Lovelace" } },
    ]);

    const names = await loadChatMentionNames({
      roomId: ROOM_ID,
      content: `@${LEGACY_AUTH_ID} can you take this one`,
    });

    expect(names.get(LEGACY_AUTH_ID)).toBe("Ada Lovelace");
    expect(userMemberFindManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, userId: { in: [LEGACY_AUTH_ID] } },
      select: { user: { select: { id: true, name: true } } },
    });
  });

  /**
   * Postgres parses a uuid with or without hyphens, and minds neither the
   * version nibble nor the variant one. A key it would have matched must not
   * be filtered out before it gets there.
   *
   * Both off-spec nibbles are exercised, so tightening the pattern to an RFC
   * version or variant class fails here rather than passing and dropping
   * those keys in silence.
   */
  it("keeps hyphenless and off-spec uuid keys in the soko bot lookup", async () => {
    const hyphenless = "019fc7e4e4bd7005900c66e44d33f5e4";
    // Version nibble `0` and variant nibble `c`, neither of which is RFC.
    const offSpecNibbles = "019fc7e4-e4bd-0005-c00c-66e44d33f5e4";

    await loadChatMentionNames({
      roomId: ROOM_ID,
      content: `@${hyphenless} @${offSpecNibbles} please`,
    });

    expect(sokoBotMemberFindManyMock).toHaveBeenCalledWith({
      where: {
        roomId: ROOM_ID,
        sokoBotId: { in: [hyphenless, offSpecNibbles] },
      },
      select: { sokoBot: { select: { id: true, name: true } } },
    });
  });
});
