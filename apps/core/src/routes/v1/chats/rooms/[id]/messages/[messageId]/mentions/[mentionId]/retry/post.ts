import { createRoute, z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";

import { publishChatRoomMessageRealtime } from "@/helpers/chat-room-message-realtime";
import { badRequest, conflict, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";
import { dispatchChatRoomMention } from "@/services/chat-room-coworker-dispatch.service";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  requireChatRoomUserWriteAccess,
} from "../../../../../../helpers";
import { assertChatRoomContentMessage } from "../../../../../../membership-status";

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
  mentionId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "mentionId", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/messages/{messageId}/mentions/{mentionId}/retry",
    description:
      "Retry a failed coworker @mention on a room message you authored. Reuses the existing mention row and dispatches again.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomMessageSchema,
        "Failed mention reset and redispatched",
      ),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Mention not found"),
      409: jsonErrorResponse("Mention is not failed"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id, messageId, mentionId } = c.req.valid("param");

    const message = await prisma.$transaction(async (tx) => {
      await requireChatRoomUserWriteAccess(id, userContext.userId, tx);

      const existing = await tx.chatRoomMessage.findFirst({
        where: { id: messageId, roomId: id },
        select: {
          id: true,
          deletedAt: true,
          senderUserId: true,
          metadata: true,
        },
      });
      if (!existing) {
        throw notFound("Message not found");
      }
      if (existing.deletedAt != null) {
        throw badRequest("Cannot retry a mention on a deleted message");
      }

      assertChatRoomContentMessage(existing.metadata);

      if (existing.senderUserId !== userContext.userId) {
        throw forbidden("You can only retry mentions you authored");
      }

      const reset = await tx.chatRoomMention.updateMany({
        where: {
          id: mentionId,
          messageId,
          status: "failed",
        },
        data: {
          status: "pending",
          error: null,
        },
      });
      if (reset.count !== 1) {
        const mention = await tx.chatRoomMention.findFirst({
          where: { id: mentionId, messageId },
          select: { id: true },
        });
        if (!mention) {
          throw notFound("Mention not found");
        }
        throw conflict("Mention is not failed");
      }

      return tx.chatRoomMessage.findUniqueOrThrow({
        where: { id: messageId },
        include: chatRoomMessageInclude,
      });
    });

    await publishChatRoomMessageRealtime(message, "mention_status");
    waitUntil(dispatchChatRoomMention(mentionId));

    return ok(
      c,
      chatRoomMessageSchema.parse(
        mapChatRoomMessage(message, userContext.userId),
      ),
    );
  });
}
