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
import {
  chatRoomMessageSchema,
  updateChatRoomMessageRequestSchema,
} from "@/schemas/chat-room.schema";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  requireChatRoomUserWriteAccess,
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
    method: "patch",
    path: "/{id}/messages/{messageId}",
    description: "Edit the content of a room message you authored.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: updateChatRoomMessageRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(chatRoomMessageSchema, "Room message updated"),
      400: jsonErrorResponse("Invalid request"),
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
    const body = c.req.valid("json");

    const message = await prisma.$transaction(async (tx) => {
      await requireChatRoomUserWriteAccess(id, userContext.userId, tx);

      const existing = await tx.chatRoomMessage.findFirst({
        where: {
          id: messageId,
          roomId: id,
        },
        include: chatRoomMessageInclude,
      });

      if (!existing) {
        throw notFound("Message not found");
      }

      if (existing.senderCoworkerId) {
        throw forbidden("Coworker messages cannot be edited");
      }

      if (existing.senderUserId !== userContext.userId) {
        throw forbidden("You can only edit your own messages");
      }

      if (existing.deletedAt != null) {
        throw forbidden("Deleted messages cannot be edited");
      }

      if (existing.content === body.content) {
        return existing;
      }

      return tx.chatRoomMessage.update({
        where: { id: messageId },
        data: {
          content: body.content,
          editedAt: new Date(),
        },
        include: chatRoomMessageInclude,
      });
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
