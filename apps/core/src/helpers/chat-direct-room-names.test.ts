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

import { loadDirectRoomNamesByReader } from "./chat-direct-room-names";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";

function human(id: string, name: string, email = `${id}@example.com`) {
  return { user: { id, name, email } };
}

beforeEach(() => {
  vi.clearAllMocks();
  userMemberFindManyMock.mockResolvedValue([]);
  coworkerMemberFindManyMock.mockResolvedValue([]);
  sokoBotMemberFindManyMock.mockResolvedValue([]);
});

describe("loadDirectRoomNamesByReader", () => {
  it("leaves the reader out of their own room name", async () => {
    userMemberFindManyMock.mockResolvedValue([
      human("user_ada", "Ada"),
      human("user_ben", "Ben"),
      human("user_cara", "Cara"),
    ]);

    const names = await loadDirectRoomNamesByReader({
      roomId: ROOM_ID,
      readerUserIds: ["user_ben", "user_cara"],
    });

    expect(names.get("user_ben")).toBe("Ada, Cara");
    expect(names.get("user_cara")).toBe("Ada, Ben");
  });

  it("orders humans, then coworkers, then Soko Bots", async () => {
    userMemberFindManyMock.mockResolvedValue([
      human("user_zoe", "Zoe"),
      human("user_ada", "Ada"),
      human("user_ben", "Ben"),
    ]);
    coworkerMemberFindManyMock.mockResolvedValue([
      { coworker: { id: "coworker_1", name: "Scout" } },
    ]);
    sokoBotMemberFindManyMock.mockResolvedValue([
      { sokoBot: { id: "bot_1", name: "Orb" } },
    ]);

    const names = await loadDirectRoomNamesByReader({
      roomId: ROOM_ID,
      readerUserIds: ["user_ada"],
    });

    // Three names, then the count: the room holds Ben, Zoe, Scout and Orb.
    expect(names.get("user_ada")).toBe("Ben, Zoe, Scout and 1 more");
  });

  it("names a member by email when they have no name", async () => {
    userMemberFindManyMock.mockResolvedValue([
      human("user_ada", "Ada"),
      human("user_ben", "", "ben@example.com"),
    ]);

    const names = await loadDirectRoomNamesByReader({
      roomId: ROOM_ID,
      readerUserIds: ["user_ada"],
    });

    expect(names.get("user_ada")).toBe("ben@example.com");
  });

  it("names an unnamed Soko Bot", async () => {
    sokoBotMemberFindManyMock.mockResolvedValue([
      { sokoBot: { id: "bot_1", name: null } },
    ]);

    const names = await loadDirectRoomNamesByReader({
      roomId: ROOM_ID,
      readerUserIds: ["user_ada"],
    });

    expect(names.get("user_ada")).toBe("Soko Bot");
  });

  it("leaves a room the reader is alone in to the stored name", async () => {
    userMemberFindManyMock.mockResolvedValue([human("user_ada", "Ada")]);

    const names = await loadDirectRoomNamesByReader({
      roomId: ROOM_ID,
      readerUserIds: ["user_ada"],
    });

    expect(names.has("user_ada")).toBe(false);
  });

  it("lists two members of the same name twice, as the sidebar does", async () => {
    userMemberFindManyMock.mockResolvedValue([
      human("user_ada", "Ada"),
      human("user_ben", "Sam"),
      human("user_cara", "Sam"),
    ]);

    const names = await loadDirectRoomNamesByReader({
      roomId: ROOM_ID,
      readerUserIds: ["user_ada"],
    });

    expect(names.get("user_ada")).toBe("Sam, Sam");
  });
});
