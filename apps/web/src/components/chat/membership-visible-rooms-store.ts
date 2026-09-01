import type { ChatRoom } from "@/lib/clients/generated/core";

/**
 * Session snapshot of membership-visible rooms from the chat sidebar list.
 * The open-room page only passes the selected room into RoomsClient (LCP);
 * Channel links still need the full set. Survives mobile Sheet unmount
 * for the same workspace; ignored when organizationId does not match.
 *
 * Instant `/chat` loading and the Chats tab unread dot also read the latest
 * snapshot (any org) so soft-nav back can first-paint real rows + overlay
 * instead of bone rows / an empty unread dot (SOK-903).
 */
const EMPTY_ROOMS: readonly ChatRoom[] = [];

export interface MembershipVisibleRoomsSnapshot {
  organizationId: string | null;
  rooms: readonly ChatRoom[];
  currentUserId: string;
}

let snapshotOrganizationKey: string | null = null;
let snapshot: readonly ChatRoom[] = EMPTY_ROOMS;
let snapshotCurrentUserId = "";
let latestSnapshot: MembershipVisibleRoomsSnapshot | null = null;
const listeners = new Set<() => void>();

function organizationKey(organizationId: string | null): string {
  return organizationId ?? "";
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function rebuildLatestSnapshot(): void {
  if (snapshotOrganizationKey === null) {
    latestSnapshot = null;
    return;
  }

  latestSnapshot = {
    organizationId:
      snapshotOrganizationKey === "" ? null : snapshotOrganizationKey,
    rooms: snapshot,
    currentUserId: snapshotCurrentUserId,
  };
}

export function publishMembershipVisibleRooms(
  rooms: readonly ChatRoom[],
  organizationId: string | null,
  currentUserId = "",
): void {
  snapshotOrganizationKey = organizationKey(organizationId);
  snapshot = rooms;
  snapshotCurrentUserId = currentUserId;
  rebuildLatestSnapshot();
  notifyListeners();
}

export function clearMembershipVisibleRoomsSnapshot(): void {
  snapshotOrganizationKey = null;
  snapshot = EMPTY_ROOMS;
  snapshotCurrentUserId = "";
  latestSnapshot = null;
  notifyListeners();
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

/**
 * Latest in-session membership-visible rooms, regardless of org key.
 * `null` until the list has published at least once this session (cold Instant).
 * Stable reference until the next publish/clear (for useSyncExternalStore).
 */
export function getLatestMembershipVisibleRoomsSnapshot(): MembershipVisibleRoomsSnapshot | null {
  return latestSnapshot;
}
