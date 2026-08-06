import { parseChatRoomIdFromChannelName } from "@sokosumi/utils";

/**
 * Extract chat room ids granted in an Ably token capability map.
 * Returns null when capability is missing or unparseable (caller falls back
 * to prop roomIds). Empty Set means token grants no chat room channels.
 */
export function chatRoomIdsFromAblyCapability(
  capability: unknown,
): Set<string> | null {
  let map: Record<string, unknown>;
  if (capability == null) {
    return null;
  }
  if (typeof capability === "string") {
    try {
      const parsed: unknown = JSON.parse(capability);
      if (
        parsed == null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return null;
      }
      map = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof capability === "object" && !Array.isArray(capability)) {
    map = capability as Record<string, unknown>;
  } else {
    return null;
  }

  const roomIds = new Set<string>();
  for (const channelName of Object.keys(map)) {
    const roomId = parseChatRoomIdFromChannelName(channelName);
    if (roomId != null) {
      roomIds.add(roomId);
    }
  }
  return roomIds;
}
