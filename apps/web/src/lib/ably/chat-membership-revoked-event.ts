import * as z from "zod";

export const CHAT_MEMBERSHIP_REVOKED_EVENT_NAME = "chat_membership_revoked";

export const chatMembershipRevokedEventSchema = z.object({
  roomId: z.string().min(1),
  reason: z.enum(["removed", "left"]),
  at: z.string().min(1),
});
