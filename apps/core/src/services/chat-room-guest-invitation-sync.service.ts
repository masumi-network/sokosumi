import { expireStalePendingInvitations } from "@/helpers/chat-room-invitation";
import prisma from "@/lib/db/prisma";

/**
 * Daily housekeeping: mark past-due guest invitations as `expired`.
 * Request paths also lazy-expire; this keeps rows and bare status queries clean.
 */
export async function expireStaleGuestInvitations(
  now: Date = new Date(),
): Promise<{ expired: number }> {
  const expired = await expireStalePendingInvitations(prisma, { now });
  return { expired };
}

export const chatRoomGuestInvitationSyncService = {
  expireStaleGuestInvitations,
};
