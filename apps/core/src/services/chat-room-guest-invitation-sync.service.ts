import { expireStalePendingInvitations } from "@/helpers/chat-room-invitation";
import prisma from "@/lib/db/prisma";

export interface ExpireStaleGuestInvitationsOptions {
  now?: Date;
  /** When already aborted (sync deadline), skip the write and return 0. */
  abortSignal?: AbortSignal;
}

/**
 * Daily housekeeping: mark past-due guest invitations as `expired`.
 * Request paths also lazy-expire; this keeps rows and bare status queries clean.
 */
export async function expireStaleGuestInvitations(
  options: ExpireStaleGuestInvitationsOptions = {},
): Promise<{ expired: number }> {
  if (options.abortSignal?.aborted) {
    return { expired: 0 };
  }
  const expired = await expireStalePendingInvitations(prisma, {
    now: options.now ?? new Date(),
  });
  return { expired };
}

export const chatRoomGuestInvitationSyncService = {
  expireStaleGuestInvitations,
};
