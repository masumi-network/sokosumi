import { afterEach, describe, expect, it } from "vitest";

import {
  clearMembershipVisibleRoomsSnapshot,
  getLatestMembershipVisibleRoomsSnapshot,
  getMembershipVisibleRooms,
  publishMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import type { ChatRoom } from "@/lib/clients/generated/core";

function room(id: string): ChatRoom {
  return { id } as ChatRoom;
}

describe("membership-visible-rooms-store", () => {
  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
  });

  it("ignores a snapshot published for a different organization", () => {
    publishMembershipVisibleRooms([room("a")], "org-a", "user-1");
    expect(getMembershipVisibleRooms("org-a").map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(getMembershipVisibleRooms("org-b")).toEqual([]);
  });

  it("replaces the snapshot when a new organization publishes", () => {
    publishMembershipVisibleRooms([room("a")], "org-a", "user-1");
    publishMembershipVisibleRooms([room("b")], "org-b", "user-1");
    expect(getMembershipVisibleRooms("org-a")).toEqual([]);
    expect(getMembershipVisibleRooms("org-b").map((item) => item.id)).toEqual([
      "b",
    ]);
  });

  it("treats personal workspace (null org) as its own key", () => {
    publishMembershipVisibleRooms([room("p")], null, "user-1");
    expect(getMembershipVisibleRooms(null).map((item) => item.id)).toEqual([
      "p",
    ]);
    expect(getMembershipVisibleRooms("org-a")).toEqual([]);
  });

  it("returns null from getLatest until something has published", () => {
    expect(getLatestMembershipVisibleRoomsSnapshot()).toBeNull();
  });

  it("exposes the latest snapshot for Instant / tab chrome without an org key", () => {
    publishMembershipVisibleRooms([room("a"), room("b")], "org-a", "user-9");
    expect(getLatestMembershipVisibleRoomsSnapshot()).toEqual({
      organizationId: "org-a",
      rooms: [room("a"), room("b")],
      currentUserId: "user-9",
    });
  });

  it("keeps an empty published list as a real snapshot (not cold)", () => {
    publishMembershipVisibleRooms([], "org-a", "user-1");
    expect(getLatestMembershipVisibleRoomsSnapshot()).toEqual({
      organizationId: "org-a",
      rooms: [],
      currentUserId: "user-1",
    });
  });
});
