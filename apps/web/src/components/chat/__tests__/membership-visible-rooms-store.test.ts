import { describe, expect, it } from "vitest";

import {
  getMembershipVisibleRooms,
  publishMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import type { ChatRoom } from "@/lib/clients/generated/core";

function room(id: string): ChatRoom {
  return { id } as ChatRoom;
}

describe("membership-visible-rooms-store", () => {
  it("ignores a snapshot published for a different organization", () => {
    publishMembershipVisibleRooms([room("a")], "org-a");
    expect(getMembershipVisibleRooms("org-a").map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(getMembershipVisibleRooms("org-b")).toEqual([]);
  });

  it("replaces the snapshot when a new organization publishes", () => {
    publishMembershipVisibleRooms([room("a")], "org-a");
    publishMembershipVisibleRooms([room("b")], "org-b");
    expect(getMembershipVisibleRooms("org-a")).toEqual([]);
    expect(getMembershipVisibleRooms("org-b").map((item) => item.id)).toEqual([
      "b",
    ]);
  });

  it("treats personal workspace (null org) as its own key", () => {
    publishMembershipVisibleRooms([room("p")], null);
    expect(getMembershipVisibleRooms(null).map((item) => item.id)).toEqual([
      "p",
    ]);
    expect(getMembershipVisibleRooms("org-a")).toEqual([]);
  });
});
