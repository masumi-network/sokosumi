import type { ChatRoomGuestInviteLink } from "@sokosumi/database";

import { getWebAppBaseUrl } from "@/config/env";
import { chatRoomGuestInviteLinkSchema } from "@/schemas/chat-room-guest-invite-link.schema";

/**
 * Maps a Prisma guest invite-link row to the OpenAPI DTO including the
 * shareable `{webBase}/chat/join/{token}` URL.
 */
export function toChatRoomGuestInviteLinkResponse(
  link: ChatRoomGuestInviteLink,
) {
  return chatRoomGuestInviteLinkSchema.parse({
    token: link.token,
    url: `${getWebAppBaseUrl()}/chat/join/${link.token}`,
    roomId: link.roomId,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(),
    revokedAt: link.revokedAt?.toISOString() ?? null,
    maxUses: link.maxUses,
    useCount: link.useCount,
  });
}
