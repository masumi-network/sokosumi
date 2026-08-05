import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const chatRoomInvitationStatusSchema = z
  .enum(["pending", "accepted", "revoked", "declined", "expired"])
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
