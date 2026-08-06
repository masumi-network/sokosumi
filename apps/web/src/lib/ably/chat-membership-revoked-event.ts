import {
  CHAT_MEMBERSHIP_REVOKE_REASONS,
  CHAT_MEMBERSHIP_REVOKED_EVENT_NAME,
} from "@sokosumi/utils";
import * as z from "zod";

export { CHAT_MEMBERSHIP_REVOKED_EVENT_NAME };

export const chatMembershipRevokedEventSchema = z.object({
  roomId: z.string().min(1),
  reason: z.enum(CHAT_MEMBERSHIP_REVOKE_REASONS),
  at: z.iso.datetime(),
});
