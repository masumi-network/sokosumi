import type { ChatRoom } from "@/lib/clients/generated/core";

import {
  compareChatRoomsByRecentActivity,
  comparePinnedChatRooms,
} from "./chat-room-activity-sort";

export interface PartitionedSidebarRooms {
  pinned: ChatRoom[];
  namedChannels: ChatRoom[];
  directMessages: ChatRoom[];
  externalJoined: ChatRoom[];
}

/** Discoverability values that live under the External/peer sidebar section. */
const PEER_SIDEBAR_DISCOVERABILITY = new Set<string>(["external", "matched"]);

/**
 * Split the unified room list for the chat sidebar.
 *
 * A pinned room of any kind lists under Pinned only, in the reader's own
 * order, and leaves the section it would otherwise sit in.
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
  const pinned: ChatRoom[] = [];
  const namedChannels: ChatRoom[] = [];
  const directMessages: ChatRoom[] = [];
  const externalJoined: ChatRoom[] = [];

  for (const room of rooms) {
    if (room.starredAt != null) {
      pinned.push(room);
      continue;
    }

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

  pinned.sort(comparePinnedChatRooms);
  // Unmuted → public → private → muted; activity within bucket.
  namedChannels.sort(compareChatRoomsByRecentActivity);
  directMessages.sort(compareChatRoomsByRecentActivity);
  externalJoined.sort(compareChatRoomsByRecentActivity);

  return { pinned, namedChannels, directMessages, externalJoined };
}
