import { describe, expect, it } from "vitest";
import { shouldShowRoomRosterControl } from "@/app/chat/utils/should-show-room-roster-control";
import type { ChatRoom } from "@/lib/clients/generated/core";

type RosterRoom = Pick<ChatRoom, "kind" | "userMembers" | "coworkerMembers">;

function participant(id: string): ChatRoom["userMembers"][number] {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    image: null,
    presence: "offline",
  };
}

function coworker(id: string): ChatRoom["coworkerMembers"][number] {
  return {
    id,
    name: id,
    slug: id,
    caption: null,
    image: null,
    presence: "offline",
  };
}

function room(overrides: Partial<RosterRoom> = {}): RosterRoom {
  return {
    kind: "channel",
    userMembers: [participant("user-1")],
    coworkerMembers: [],
    ...overrides,
  };
}

describe("shouldShowRoomRosterControl", () => {
  it("shows on channels even with two participants", () => {
    expect(
      shouldShowRoomRosterControl(
        room({
          userMembers: [participant("user-1"), participant("user-2")],
        }),
      ),
    ).toBe(true);
  });

  it("hides on human 1:1 directs", () => {
    expect(
      shouldShowRoomRosterControl(
        room({
          kind: "direct",
          userMembers: [participant("user-1"), participant("user-2")],
        }),
      ),
    ).toBe(false);
  });

  it("hides on coworker 1:1 directs", () => {
    expect(
      shouldShowRoomRosterControl(
        room({
          kind: "direct",
          userMembers: [participant("user-1")],
          coworkerMembers: [coworker("coworker-1")],
        }),
      ),
    ).toBe(false);
  });

  it("shows on group directs", () => {
    expect(
      shouldShowRoomRosterControl(
        room({
          kind: "direct",
          userMembers: [
            participant("user-1"),
            participant("user-2"),
            participant("user-3"),
          ],
        }),
      ),
    ).toBe(true);
  });
});
