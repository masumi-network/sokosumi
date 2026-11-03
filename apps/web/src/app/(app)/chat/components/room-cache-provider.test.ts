import { afterEach, describe, expect, it } from "vitest";
import {
  makeRoom,
  makeUser,
} from "@/components/chat/__tests__/chat-room-fixtures";
import {
  clearMembershipVisibleRoomsSnapshot,
  publishMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";

import {
  clickOpensAtUnread,
  provisionalRoomBootstrap,
} from "./room-cache-provider";

describe("provisionalRoomBootstrap", () => {
  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
  });

  it("builds room chrome from the sidebar's row", () => {
    const room = makeRoom({ id: "room-1", organizationId: "org-1" });
    publishMembershipVisibleRooms([room], "org-1", "reader");

    expect(provisionalRoomBootstrap("room-1", "reader", "org-1")).toEqual(
      expect.objectContaining({
        activeOrganization: { id: "org-1", slug: null },
        rooms: [room],
        currentUserId: "reader",
        isOrgOwnerOrAdmin: false,
        selectedRoomId: "room-1",
        loadHistoryOnClient: true,
      }),
    );
  });

  it("has no organization in the personal workspace", () => {
    const room = makeRoom({ id: "room-1", organizationId: null });
    publishMembershipVisibleRooms([room], null, "reader");

    expect(
      provisionalRoomBootstrap("room-1", "reader", null)?.activeOrganization,
    ).toBeNull();
  });

  it("waits for the page when the sidebar shows another user or workspace", () => {
    publishMembershipVisibleRooms(
      [makeRoom({ id: "room-1" })],
      "org-1",
      "reader",
    );

    expect(provisionalRoomBootstrap("room-1", "someone", "org-1")).toBeNull();
    expect(provisionalRoomBootstrap("room-1", "reader", "org-2")).toBeNull();
  });

  it("waits for the page when the sidebar has no row for the room", () => {
    publishMembershipVisibleRooms(
      [makeRoom({ id: "room-1" })],
      "org-1",
      "reader",
    );

    expect(provisionalRoomBootstrap("room-2", "reader", "org-1")).toBeNull();
  });

  it("waits for the page for a coworker stream room", () => {
    const room = makeRoom({
      id: "room-1",
      kind: "direct",
      slug: null,
      userMembers: [makeUser("reader")],
      coworkerMembers: [
        {
          id: "coworker-1",
          name: "Coworker",
          slug: "coworker",
          caption: null,
          image: null,
          presence: "online",
        },
      ],
    });
    publishMembershipVisibleRooms([room], "org-1", "reader");

    expect(provisionalRoomBootstrap("room-1", "reader", "org-1")).toBeNull();
  });
});

describe("clickOpensAtUnread", () => {
  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
  });
  const url = (search = "") =>
    new URL(`http://localhost/chat/rooms/room-1${search}`);

  it("opens at the divider when the sidebar's row has Room unread", () => {
    publishMembershipVisibleRooms(
      [makeRoom({ id: "room-1", unreadCount: 3, channelUnreadCount: 3 })],
      "org-1",
      "reader",
    );

    expect(clickOpensAtUnread(url(), "room-1", "reader", "org-1")).toBe(true);
    // A named message wins the open, as it does in the room.
    expect(
      clickOpensAtUnread(url("?message=m1"), "room-1", "reader", "org-1"),
    ).toBe(false);
    expect(clickOpensAtUnread(url(), "room-1", "someone", "org-1")).toBe(false);
  });

  it("does not for Thread unread alone or a read room", () => {
    publishMembershipVisibleRooms(
      [makeRoom({ id: "room-1", unreadCount: 2, channelUnreadCount: 0 })],
      "org-1",
      "reader",
    );

    expect(clickOpensAtUnread(url(), "room-1", "reader", "org-1")).toBe(false);
  });
});
