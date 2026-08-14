import { describe, expect, it } from "vitest";
import type {
  ChatRoom,
  ChatRoomCoworkerParticipant,
  ChatRoomUserParticipant,
} from "@/lib/clients/generated/core";
import {
  getDirectRoomParticipants,
  getRoomDisplayName,
  getRoomParticipantPreviews,
} from "../room-helpers";

const CURRENT_USER_ID = "self";

function human(
  partial: Pick<ChatRoomUserParticipant, "id" | "name"> &
    Partial<ChatRoomUserParticipant>,
): ChatRoomUserParticipant {
  return {
    email: `${partial.id}@example.com`,
    image: null,
    presence: "offline",
    ...partial,
  };
}

function coworker(
  partial: Pick<ChatRoomCoworkerParticipant, "id" | "name"> &
    Partial<ChatRoomCoworkerParticipant>,
): ChatRoomCoworkerParticipant {
  return {
    slug: partial.id,
    caption: null,
    image: null,
    presence: "offline",
    ...partial,
  };
}

function directRoom(overrides: {
  userMembers: ChatRoomUserParticipant[];
  coworkerMembers?: ChatRoomCoworkerParticipant[];
}): ChatRoom {
  return {
    id: "room-1",
    organizationId: "org-1",
    name: "Direct",
    slug: "direct",
    kind: "direct",
    directKey: "key",
    topic: null,
    discoverability: null,
    createdByUserId: CURRENT_USER_ID,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    unreadCount: 0,
    unreadThreadReplyCount: 0,
    unreadMentionCount: 0,
    pinnedAt: null,
    mutedAt: null,
    markedUnread: false,
    coworkerMembers: [],
    ...overrides,
  } as ChatRoom;
}

describe("direct room display order", () => {
  it("getRoomDisplayName ignores opposite userMembers array orders", () => {
    const self = human({ id: CURRENT_USER_ID, name: "Me" });
    const francis = human({ id: "francis", name: "Francis Luz" });
    const patrick = human({ id: "patrick", name: "Patrick Tobler" });

    const orderA = directRoom({
      userMembers: [self, francis, patrick],
    });
    const orderB = directRoom({
      userMembers: [self, patrick, francis],
    });

    expect(getRoomDisplayName(orderA, CURRENT_USER_ID)).toBe(
      "Francis Luz, Patrick Tobler",
    );
    expect(getRoomDisplayName(orderB, CURRENT_USER_ID)).toBe(
      "Francis Luz, Patrick Tobler",
    );
  });

  it("getDirectRoomParticipants returns stable id sequence across opposite input orders", () => {
    const self = human({ id: CURRENT_USER_ID, name: "Me" });
    const francis = human({ id: "francis", name: "Francis Luz" });
    const patrick = human({ id: "patrick", name: "Patrick Tobler" });

    const orderA = directRoom({
      userMembers: [self, francis, patrick],
    });
    const orderB = directRoom({
      userMembers: [self, patrick, francis],
    });

    const idsA = getDirectRoomParticipants(orderA, CURRENT_USER_ID).map(
      (p) => p.id,
    );
    const idsB = getDirectRoomParticipants(orderB, CURRENT_USER_ID).map(
      (p) => p.id,
    );

    expect(idsA).toEqual(["francis", "patrick"]);
    expect(idsB).toEqual(idsA);
  });

  it("sorts humans before coworkers after name sort within each band", () => {
    const self = human({ id: CURRENT_USER_ID, name: "Me" });
    const zara = human({ id: "zara", name: "Zara" });
    const ada = human({ id: "ada", name: "Ada" });
    const aaron = coworker({ id: "aaron", name: "Aaron" });

    const room = directRoom({
      userMembers: [self, zara, ada],
      coworkerMembers: [aaron],
    });

    expect(getRoomDisplayName(room, CURRENT_USER_ID)).toBe("Ada, Zara, Aaron");
  });

  it("breaks name ties by id", () => {
    const self = human({ id: CURRENT_USER_ID, name: "Me" });
    const alex2 = human({ id: "a-2", name: "Alex" });
    const alex1 = human({ id: "a-1", name: "Alex" });

    const room = directRoom({
      userMembers: [self, alex2, alex1],
    });

    expect(
      getDirectRoomParticipants(room, CURRENT_USER_ID).map((p) => p.id),
    ).toEqual(["a-1", "a-2"]);
  });

  it("getRoomParticipantPreviews ignores input order within humans and coworkers", () => {
    const self = human({ id: CURRENT_USER_ID, name: "Me" });
    const zara = human({ id: "zara", name: "Zara" });
    const ada = human({ id: "ada", name: "Ada" });
    const coworkerZ = coworker({ id: "cw-z", name: "Zed" });
    const coworkerA = coworker({ id: "cw-a", name: "Abby" });

    const orderA = directRoom({
      userMembers: [self, zara, ada],
      coworkerMembers: [coworkerZ, coworkerA],
    });
    const orderB = directRoom({
      userMembers: [ada, self, zara],
      coworkerMembers: [coworkerA, coworkerZ],
    });

    const idsA = getRoomParticipantPreviews(orderA).map((p) => p.id);
    const idsB = getRoomParticipantPreviews(orderB).map((p) => p.id);

    expect(idsA).toEqual(["ada", CURRENT_USER_ID, "zara", "cw-a", "cw-z"]);
    expect(idsB).toEqual(idsA);
  });
});
