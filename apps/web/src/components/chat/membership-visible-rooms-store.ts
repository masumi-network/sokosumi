import type { ChatRoom } from "@/lib/clients/generated/core";

/**
 * Session snapshot of membership-visible rooms from the chat sidebar list.
 * The open-room page only passes the selected room into RoomsClient (LCP);
 * Channel links still need the full set. Survives mobile Sheet unmount
 * for the same workspace; ignored when organizationId does not match.
 */
const EMPTY_ROOMS: readonly ChatRoom[] = [];

let snapshotOrganizationKey: string | null = null;
let snapshot: readonly ChatRoom[] = EMPTY_ROOMS;
const listeners = new Set<() => void>();

function organizationKey(organizationId: string | null): string {
  return organizationId ?? "";
}

export function publishMembershipVisibleRooms(
  rooms: readonly ChatRoom[],
  organizationId: string | null,
): void {
  snapshotOrganizationKey = organizationKey(organizationId);
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

export function getMembershipVisibleRooms(
  organizationId: string | null,
): readonly ChatRoom[] {
  if (snapshotOrganizationKey !== organizationKey(organizationId)) {
    return EMPTY_ROOMS;
  }
  return snapshot;
}
