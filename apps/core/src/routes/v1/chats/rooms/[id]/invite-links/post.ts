import crypto from "node:crypto";

import { createRoute, z } from "@hono/zod-openapi";
import { chatRoomGuestInviteLinkRepository } from "@sokosumi/database/repositories";

import { LIMITS } from "@/config/constants";
import { toChatRoomGuestInviteLinkResponse } from "@/helpers/chat-room-guest-invite-link-response";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  chatRoomGuestInviteLinkSchema,
  createChatRoomGuestInviteLinkRequestSchema,
} from "@/schemas/chat-room-guest-invite-link.schema";

import { requireRoomMemberCanInviteGuests } from "../../helpers";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/invite-links",
    description:
      "Create a shareable, email-agnostic guest invite link for an external channel. Caller must be a host-org room member (`access=member`). Anyone signed in who is not a host-org member may claim the link as `access=guest`.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: createChatRoomGuestInviteLinkRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        chatRoomGuestInviteLinkSchema,
        "Shareable guest invite link created",
      ),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      429: jsonErrorResponse("Invite link rate limit exceeded"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id: roomId } = c.req.valid("param");
    const body = c.req.valid("json");

    const link = await prisma.$transaction(async (tx) => {
      await requireRoomMemberCanInviteGuests(roomId, userContext.userId, tx);

      // Serialize active-link counts and hourly creates against concurrent mints.
      await tx.$queryRaw`
        SELECT "id" FROM "chat_room"
        WHERE "id" = ${roomId}::uuid
        FOR UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "user"
        WHERE "id" = ${userContext.userId}
        FOR UPDATE
      `;

      const now = new Date();
      const liveCount =
        await chatRoomGuestInviteLinkRepository.countLiveInviteLinksByRoomId(
          roomId,
          now,
          tx,
        );
      if (liveCount >= LIMITS.CHAT_ROOM_GUEST_INVITE_LINK_ACTIVE_LIMIT) {
        throw badRequest(
          `This channel already has ${LIMITS.CHAT_ROOM_GUEST_INVITE_LINK_ACTIVE_LIMIT} active invite links. Revoke some before creating more.`,
        );
      }

      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const recentCreates =
        await chatRoomGuestInviteLinkRepository.countRecentCreatesByUser(
          userContext.userId,
          hourAgo,
          tx,
        );
      if (recentCreates >= LIMITS.CHAT_ROOM_GUEST_INVITE_LINK_CREATE_PER_HOUR) {
        throw badRequest(
          `You can create at most ${LIMITS.CHAT_ROOM_GUEST_INVITE_LINK_CREATE_PER_HOUR} shareable invite links per hour. Try again later.`,
        );
      }

      const token = crypto.randomBytes(24).toString("base64url");
      const expiresInDays = body.expiresInDays ?? 7;
      const expiresAt = new Date(
        now.getTime() + expiresInDays * 24 * 60 * 60 * 1000,
      );
      const maxUses = body.maxUses ?? null;

      return await chatRoomGuestInviteLinkRepository.createInviteLink(
        {
          token,
          roomId,
          createdByUserId: userContext.userId,
          expiresAt,
          maxUses,
        },
        tx,
      );
    });

    return created(c, toChatRoomGuestInviteLinkResponse(link));
  });
}
