import { describe, expect, it } from "vitest";
import { isReadOnlyChatRoom } from "./read-only-room";

const ARCHIVED_AT = new Date("2026-10-01T00:00:00.000Z");

function sharedBotChannel(
  sharedSokoBot: { archivedAt: Date | null; deletedAt: Date | null } | null,
) {
  return {
    kind: "channel",
    directKey: null,
    userMembers: [{ userId: "user_a" }, { userId: "user_b" }],
    coworkerMembers: [],
    sokoBotMembers: [],
    sharedSokoBot,
  };
}

describe("isReadOnlyChatRoom", () => {
  it("marks the room of an archived shared Soko Bot read-only", () => {
    expect(
      isReadOnlyChatRoom(
        sharedBotChannel({ archivedAt: ARCHIVED_AT, deletedAt: null }),
      ),
    ).toBe(true);
  });

  it("marks the room of a deleted shared Soko Bot read-only", () => {
    expect(
      isReadOnlyChatRoom(
        sharedBotChannel({ archivedAt: null, deletedAt: ARCHIVED_AT }),
      ),
    ).toBe(true);
  });

  it("keeps a live shared Soko Bot's room and a plain Channel writable", () => {
    expect(
      isReadOnlyChatRoom(
        sharedBotChannel({ archivedAt: null, deletedAt: null }),
      ),
    ).toBe(false);
    expect(isReadOnlyChatRoom(sharedBotChannel(null))).toBe(false);
  });

  it("still marks a Direct everyone else left read-only", () => {
    expect(
      isReadOnlyChatRoom({
        kind: "direct",
        directKey: "user_a:user_b",
        userMembers: [{ userId: "user_a" }],
        coworkerMembers: [],
        sokoBotMembers: [],
        sharedSokoBot: null,
      }),
    ).toBe(true);
  });
});
