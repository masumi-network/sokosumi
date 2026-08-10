import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/** Guest invitation lifecycle statuses (Prisma column + OpenAPI enum). */
export const CHAT_ROOM_INVITATION_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REVOKED: "revoked",
  DECLINED: "declined",
  EXPIRED: "expired",
} as const;

export const chatRoomInvitationStatusSchema = z
  .enum([
    CHAT_ROOM_INVITATION_STATUS.PENDING,
    CHAT_ROOM_INVITATION_STATUS.ACCEPTED,
    CHAT_ROOM_INVITATION_STATUS.REVOKED,
    CHAT_ROOM_INVITATION_STATUS.DECLINED,
    CHAT_ROOM_INVITATION_STATUS.EXPIRED,
  ])
  .openapi("ChatRoomInvitationStatus");

export const createChatRoomInvitationRequestSchema = z
  .object({
    email: z.string().trim().email().openapi({ example: "guest@example.com" }),
  })
  .openapi("CreateChatRoomInvitationRequest");

export const chatRoomInvitationSchema = z
  .object({
    id: z.string().uuid(),
    roomId: z.string().uuid(),
    roomName: z.string(),
    organizationId: z.string(),
    organizationName: z.string(),
    email: z.string().email(),
    status: chatRoomInvitationStatusSchema,
    inviter: z.object({
      id: z.string(),
      name: z.string(),
    }),
    expiresAt: dateTimeSchema,
    createdAt: dateTimeSchema,
  })
  .openapi("ChatRoomInvitation");

export type ChatRoomInvitationStatus = z.infer<
  typeof chatRoomInvitationStatusSchema
>;
export type CreateChatRoomInvitationRequest = z.infer<
  typeof createChatRoomInvitationRequestSchema
>;
export type ChatRoomInvitation = z.infer<typeof chatRoomInvitationSchema>;
