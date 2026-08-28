import type { ChatRoom } from "@/lib/clients/generated/core";

import { compareChatRoomsByRecentActivity } from "./chat-room-activity-sort";

export interface PartitionedSidebarRooms {
  namedChannels: ChatRoom[];
  directMessages: ChatRoom[];
  externalJoined: ChatRoom[];
}

/** Discoverability values that live under the External/peer sidebar section. */
const PEER_SIDEBAR_DISCOVERABILITY = new Set<string>(["external", "matched"]);

/**
 * Split the unified room list for the chat sidebar.
 *
 * External and matched channels (`discoverability === "external" | "matched"`)
 * — host members, guests, and matched roster members — live only under
 * External, never under Channels, so they read as a peer section next to
 * Channels / Direct Messages. Every Direct lists under Direct Messages,
 * including Personal 1:1s with a Guest.
 */
export function partitionRoomsForSidebar(
  rooms: ChatRoom[],
): PartitionedSidebarRooms {
  const namedChannels: ChatRoom[] = [];
  const directMessages: ChatRoom[] = [];
  const externalJoined: ChatRoom[] = [];

  for (const room of rooms) {
    if (
      room.kind === "channel" &&
      room.discoverability != null &&
      PEER_SIDEBAR_DISCOVERABILITY.has(room.discoverability)
    ) {
      externalJoined.push(room);
      continue;
    }

    // Guests are always on external rooms (DB invariant); keep as safety net.
    if (room.myAccess === "guest") {
      externalJoined.push(room);
      continue;
    }

    if (room.kind === "channel") {
      namedChannels.push(room);
      continue;
    }

    if (room.kind === "direct") {
      directMessages.push(room);
    }
  }

  // Unmuted → pinned → public → private → muted; activity within bucket.
  namedChannels.sort(compareChatRoomsByRecentActivity);
  directMessages.sort(compareChatRoomsByRecentActivity);
  externalJoined.sort(compareChatRoomsByRecentActivity);

  return { namedChannels, directMessages, externalJoined };
}
