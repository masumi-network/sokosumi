import type { ChatRoom } from "@/lib/clients/generated/core";

/**
 * Session snapshot of membership-visible rooms from the chat sidebar list.
 * The open-room page only passes the selected room into RoomsClient (LCP);
 * Channel links still need the full set. Survives mobile Sheet unmount.
 */
let snapshot: readonly ChatRoom[] = [];
const listeners = new Set<() => void>();

export function publishMembershipVisibleRooms(
  rooms: readonly ChatRoom[],
): void {
  snapshot = rooms;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeMembershipVisibleRooms(
  onStoreChange: () => void,
): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getMembershipVisibleRooms(): readonly ChatRoom[] {
  return snapshot;
}
