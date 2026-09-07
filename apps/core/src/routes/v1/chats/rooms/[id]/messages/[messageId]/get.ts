import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
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
    method: "get",
    path: "/{id}/messages/{messageId}",
    description:
      "Read one message in a room. A caller holding only a message id, such as a notification deep link, reads it here to learn whether the message is a top-level one or a reply, and which thread it belongs to.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomMessageSchema, "Room message"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Message not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id, messageId } = c.req.valid("param");

    // Read-only, so no interactive transaction: the membership gate and the
    // message read do not need a shared snapshot. Same reasoning as the
    // message list beside it.
    await requireChatRoomUserMembership(id, userContext.userId, prisma);

    const message = await prisma.chatRoomMessage.findFirst({
      where: { id: messageId, roomId: id },
      include: chatRoomMessageInclude,
    });

    if (!message) {
      throw notFound("Message not found");
    }

    // Soft-deleted messages are returned as the tombstone they are. A reader
    // who followed a notification to a message somebody has since deleted is
    // better served by the room around it than by an error.
    return ok(c, chatRoomMessageSchema.parse(mapChatRoomMessage(message)));
  });
}
