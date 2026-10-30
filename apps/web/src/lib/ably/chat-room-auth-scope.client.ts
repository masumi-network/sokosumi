"use client";

/** Message and typing subscribers share one client and its renewed grants. */
const roomSubscriberCounts = new Map<string, number>();

export function getAblyChatRoomScope(): string[] {
  return [...roomSubscriberCounts.keys()].sort();
}

export function registerAblyChatRoomScope(
  roomIds: readonly string[],
): () => void {
  const registeredRoomIds = [...new Set(roomIds)].filter(Boolean);
  for (const roomId of registeredRoomIds) {
    roomSubscriberCounts.set(
      roomId,
      (roomSubscriberCounts.get(roomId) ?? 0) + 1,
    );
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    for (const roomId of registeredRoomIds) {
      const count = (roomSubscriberCounts.get(roomId) ?? 0) - 1;
      if (count > 0) {
        roomSubscriberCounts.set(roomId, count);
      } else {
        roomSubscriberCounts.delete(roomId);
      }
    }
  };
}
