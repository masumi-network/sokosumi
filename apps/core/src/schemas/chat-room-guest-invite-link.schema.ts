import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const createChatRoomGuestInviteLinkRequestSchema = z
  .object({
    /** Days until the link expires (1–90). Defaults to 7. */
    expiresInDays: z.number().int().min(1).max(90).default(7).optional(),
    /** Cap on total guest joins. Null/omitted = unlimited until expiry. */
    maxUses: z.number().int().min(1).max(10_000).nullable().optional(),
  })
  .openapi("CreateChatRoomGuestInviteLinkRequest");

export const chatRoomGuestInviteLinkSchema = z
  .object({
    token: z.string(),
    /** Full shareable URL (`{webBase}/chat/join/{token}`). */
    url: z.string().url(),
    roomId: z.string().uuid(),
    createdAt: dateTimeSchema,
    expiresAt: dateTimeSchema,
    revokedAt: dateTimeSchema.nullable(),
    maxUses: z.number().int().nullable(),
    useCount: z.number().int(),
  })
  .openapi("ChatRoomGuestInviteLink");

/** Public preview for `/chat/join` — no room data for bad tokens. */
export const resolveChatRoomGuestInviteLinkResponseSchema = z
  .object({
    status: z.enum(["valid", "expired", "revoked", "depleted", "not_found"]),
    room: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        organizationId: z.string(),
        organizationName: z.string(),
      })
      .nullable(),
  })
  .openapi("ResolveChatRoomGuestInviteLink");

export const acceptChatRoomGuestInviteLinkResponseSchema = z
  .object({
    status: z.enum(["joined", "already_guest"]),
    roomId: z.string().uuid(),
    roomName: z.string(),
  })
  .openapi("AcceptChatRoomGuestInviteLink");
