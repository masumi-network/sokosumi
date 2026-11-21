import type { ChatRoom } from "@sokosumi/core-client";
import { render } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearMembershipVisibleRoomsSnapshot,
  getMembershipVisibleRooms,
  hasLiveMembershipVisibleRoomsPublisher,
  subscribeMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import { useMembershipVisibleRoomsPublisher } from "./use-membership-visible-rooms-publisher";

const roomA = { id: "room-a", name: "Room A" } as ChatRoom;
const roomB = { id: "room-b", name: "Room B" } as ChatRoom;
const sourceRooms = [roomA];

function Publisher({
  rooms,
  organizationId,
  currentUserId = "user-1",
  enabled = true,
}: {
  rooms: readonly ChatRoom[];
  organizationId: string | null;
  currentUserId?: string;
  enabled?: boolean;
}) {
  useMembershipVisibleRoomsPublisher({
    rooms,
    organizationId,
    currentUserId,
    sourceRooms,
    enabled,
  });
  return null;
}

describe("useMembershipVisibleRoomsPublisher", () => {
  beforeEach(() => {
    clearMembershipVisibleRoomsSnapshot();
  });

  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
  });

  it("publishes rooms, tracks live publisher status without bouncing on room updates, and skips when disabled", () => {
    const { rerender, unmount } = render(
      <Publisher rooms={[roomA]} organizationId="org-1" enabled={false} />,
    );
    expect(hasLiveMembershipVisibleRoomsPublisher()).toBe(false);
    expect(getMembershipVisibleRooms("org-1")).toEqual([]);

    rerender(<Publisher rooms={[roomA]} organizationId="org-1" enabled />);
    expect(hasLiveMembershipVisibleRoomsPublisher()).toBe(true);
    expect(getMembershipVisibleRooms("org-1")).toEqual([roomA]);

    const observedLiveStates: boolean[] = [];
    const unsubscribe = subscribeMembershipVisibleRooms(() => {
      observedLiveStates.push(hasLiveMembershipVisibleRoomsPublisher());
    });
    try {
      rerender(
        <Publisher rooms={[roomA, roomB]} organizationId="org-1" enabled />,
      );
      expect(getMembershipVisibleRooms("org-1")).toEqual([roomA, roomB]);
      expect(observedLiveStates).toEqual([true]);

      rerender(<Publisher rooms={[roomB]} organizationId="org-2" enabled />);
      expect(getMembershipVisibleRooms("org-1")).toEqual([]);
      expect(getMembershipVisibleRooms("org-2")).toEqual([roomB]);
    } finally {
      unsubscribe();
    }

    unmount();
    expect(hasLiveMembershipVisibleRoomsPublisher()).toBe(false);
  });

  it("unregisters on React Activity hide and re-registers on reveal", () => {
    const { rerender } = render(
      <Activity mode="visible">
        <Publisher rooms={[roomA]} organizationId="org-1" />
      </Activity>,
    );
    expect(hasLiveMembershipVisibleRoomsPublisher()).toBe(true);

    rerender(
      <Activity mode="hidden">
        <Publisher rooms={[roomA]} organizationId="org-1" />
      </Activity>,
    );
    expect(hasLiveMembershipVisibleRoomsPublisher()).toBe(false);

    clearMembershipVisibleRoomsSnapshot();
    expect(getMembershipVisibleRooms("org-1")).toEqual([]);

    rerender(
      <Activity mode="visible">
        <Publisher rooms={[roomA]} organizationId="org-1" />
      </Activity>,
    );
    expect(hasLiveMembershipVisibleRoomsPublisher()).toBe(true);
    expect(getMembershipVisibleRooms("org-1")).toEqual([roomA]);
  });
});
