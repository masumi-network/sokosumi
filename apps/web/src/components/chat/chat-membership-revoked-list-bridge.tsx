"use client";

import { useChatMembershipRevokedControl } from "@/lib/ably/use-chat-membership-revoked-control";

import { notifyOrganizationChatRoomsChanged } from "./organization-chat-events";

/**
 * List-mounted control-channel UI (SOK-746). Soft-removes membership-visible
 * rooms when kicked even if the open-room Ably island is not mounted.
 * Navigation/refresh lives only on the open-room bridge so both mounts never
 * double `replace`/`refresh` for the same event.
 */
export function ChatMembershipRevokedListBridge({
  currentUserId,
}: {
  currentUserId: string;
}) {
  useChatMembershipRevokedControl({
    currentUserId,
    onRevoked: (event) => {
      notifyOrganizationChatRoomsChanged({ removedRoomId: event.roomId });
    },
  });

  return null;
}
