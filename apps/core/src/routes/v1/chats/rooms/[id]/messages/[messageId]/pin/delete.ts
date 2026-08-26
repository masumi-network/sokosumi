import { createRoute, z } from "@hono/zod-openapi";

import { publishChatRoomPinnedMessageRealtime } from "@/helpers/chat-room-pinned-message-realtime";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomPinnedMessageMutationSchema } from "@/schemas/chat-room.schema";

import { requireChatRoomUserMembership } from "../../../../helpers";

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
    path: "/{id}/messages/{messageId}/pin",
    description:
      "Remove a message from a Channel's shared pin list. Idempotent if it was not pinned. Directs are rejected.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomPinnedMessageMutationSchema,
        "Message unpinned",
      ),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id, messageId } = c.req.valid("param");

    const result = await prisma.$transaction(async (tx) => {
      const room = await requireChatRoomUserMembership(
        id,
        userContext.userId,
        tx,
      );
      if (room.kind !== "channel") {
        throw badRequest("Only Channels can have pinned messages.");
      }

      const removed = await tx.chatRoomPinnedMessage.deleteMany({
        where: { roomId: id, messageId },
      });

      const pinnedMessageCount = await tx.chatRoomPinnedMessage.count({
        where: { roomId: id },
      });

      return { messageId, pinnedMessageCount, published: removed.count > 0 };
    });

    if (result.published) {
      await publishChatRoomPinnedMessageRealtime({
        action: "unpin",
        roomId: id,
        messageId,
        pinnedMessageCount: result.pinnedMessageCount,
      });
    }

    return ok(c, chatRoomPinnedMessageMutationSchema.parse(result));
  });
}
