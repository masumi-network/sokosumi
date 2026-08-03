import { createRoute, z } from "@hono/zod-openapi";

import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  requireChatRoomUserMembership,
} from "../../../helpers";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
  messageId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "messageId", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/messages/{messageId}",
    description:
      "Soft-delete a room message the current user authored. Idempotent for already-deleted messages.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomMessageSchema,
        "Room message soft-deleted",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Message not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id, messageId } = c.req.valid("param");

    const message = await prisma.$transaction(async (tx) => {
      await requireChatRoomUserMembership(id, userContext.userId, tx);

      const existing = await tx.chatRoomMessage.findFirst({
        where: { id: messageId, roomId: id },
        include: chatRoomMessageInclude,
      });
      if (!existing) {
        throw notFound("Message not found");
      }

      if (existing.senderUserId !== userContext.userId) {
        throw forbidden("You can only delete your own messages");
      }

      if (existing.deletedAt != null) {
        // Already tombstoned — still cancel any non-terminal coworker
        // mentions so a late waitUntil cannot revive work against it.
        await tx.chatRoomMention.updateMany({
          where: {
            messageId,
            status: { in: ["pending", "sent"] },
          },
          data: {
            status: "failed",
            error: "Source message was deleted",
          },
        });
        return existing;
      }

      const updated = await tx.chatRoomMessage.update({
        where: { id: messageId },
        data: {
          deletedAt: new Date(),
          content: "",
          metadata: null,
        },
        include: chatRoomMessageInclude,
      });

      // Soft-delete must stop coworker dispatch: otherwise waitUntil still
      // burns credits and can post a reply under a wiped tombstone.
      await tx.chatRoomMention.updateMany({
        where: {
          messageId,
          status: { in: ["pending", "sent"] },
        },
        data: {
          status: "failed",
          error: "Source message was deleted",
        },
      });

      return updated;
    });

    await publishChatRoomMessageRealtime(message);

    return ok(
      c,
      chatRoomMessageSchema.parse(
        mapChatRoomMessage(message, userContext.userId),
      ),
    );
  });
}
