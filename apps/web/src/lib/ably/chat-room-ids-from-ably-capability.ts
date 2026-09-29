import { parseChatRoomIdFromChannelName } from "@sokosumi/utils";

import { parseAblyCapabilityMap } from "./ably-capability-map";

/**
 * Extract chat room ids granted in an Ably token capability map.
 * Returns null when capability is missing or unparseable (caller falls back
 * to prop roomIds). Empty Set means token grants no chat room channels.
 * Only channels with an explicit `subscribe` op are included.
 */
export function chatRoomIdsFromAblyCapability(
  capability: unknown,
): Set<string> | null {
  const map = parseAblyCapabilityMap(capability);
  if (map == null) {
    return null;
  }

  const roomIds = new Set<string>();
  for (const [channelName, operations] of Object.entries(map)) {
    if (!Array.isArray(operations) || !operations.includes("subscribe")) {
      continue;
    }
    const roomId = parseChatRoomIdFromChannelName(channelName);
    if (roomId != null) {
      roomIds.add(roomId);
    }
  }
  return roomIds;
}
