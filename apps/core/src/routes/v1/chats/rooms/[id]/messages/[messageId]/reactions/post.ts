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
import {
  chatRoomMessageSchema,
  reactToChatRoomMessageRequestSchema,
} from "@/schemas/chat-room.schema";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  requireChatRoomUserMembership,
} from "../../../../helpers";

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
    method: "post",
    path: "/{id}/messages/{messageId}/reactions",
    description: "Toggle the current user's emoji reaction on a room message.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: reactToChatRoomMessageRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomMessageSchema,
        "Room message reaction toggled",
      ),
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
    const emoji = body.emoji.trim();

    const message = await prisma.$transaction(async (tx) => {
      await requireChatRoomUserMembership(id, userContext.userId, tx);

      // Lock the message row so concurrent toggles of the same reaction cannot
      // interleave delete-then-create and flip the row back on. Without this,
      // two "remove" intents both delete (counts 1 and 0) and the loser
      // re-inserts. Matches the FOR UPDATE pattern used on conversation writes.
      const lockedMessages = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "chat_room_message"
        WHERE "id" = ${messageId}::uuid AND "roomId" = ${id}::uuid
        FOR UPDATE
      `;
      if (lockedMessages.length === 0) {
        throw notFound("Message not found");
      }

      // Under the message lock, delete-then-create is a true toggle: either we
      // removed an existing row, or we insert one. `skipDuplicates` still
      // guards the unique index if a concurrent path somehow races past the lock.
      const removed = await tx.chatRoomReaction.deleteMany({
        where: {
          messageId,
          userId: userContext.userId,
          emoji,
        },
      });

      if (removed.count === 0) {
        await tx.chatRoomReaction.createMany({
          data: {
            messageId,
            userId: userContext.userId,
            emoji,
          },
          skipDuplicates: true,
        });
      }

      return tx.chatRoomMessage.findUniqueOrThrow({
        where: { id: messageId },
        include: chatRoomMessageInclude,
      });
    });

    return ok(
      c,
      chatRoomMessageSchema.parse(
        mapChatRoomMessage(message, userContext.userId),
      ),
    );
  });
}
