import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  chatChannelMessageSchema,
  reactToChatChannelMessageRequestSchema,
} from "@/schemas/chat-channel.schema";

import {
  chatChannelMessageInclude,
  mapChatChannelMessage,
  requireChatChannelUserAccess,
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
    description:
      "Toggle the current user's emoji reaction on a channel message.",
    tags: ["Chat Channels"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: reactToChatChannelMessageRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        chatChannelMessageSchema,
        "Channel message reaction toggled",
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
    const userContext = requireUserContext(c.var.authContext);
    const { id, messageId } = c.req.valid("param");
    const body = c.req.valid("json");
    const emoji = body.emoji.trim();

    const message = await prisma.$transaction(async (tx) => {
      await requireChatChannelUserAccess(id, userContext.userId, tx);
      const existingMessage = await tx.chatChannelMessage.findFirst({
        where: {
          id: messageId,
          channelId: id,
        },
        select: { id: true },
      });
      if (!existingMessage) {
        throw notFound("Message not found");
      }

      const existingReaction = await tx.chatChannelReaction.findFirst({
        where: {
          messageId,
          userId: userContext.userId,
          emoji,
        },
        select: { id: true },
      });

      if (existingReaction) {
        await tx.chatChannelReaction.delete({
          where: { id: existingReaction.id },
        });
      } else {
        await tx.chatChannelReaction.create({
          data: {
            messageId,
            userId: userContext.userId,
            emoji,
          },
        });
      }

      return tx.chatChannelMessage.findUniqueOrThrow({
        where: { id: messageId },
        include: chatChannelMessageInclude,
      });
    });

    return ok(
      c,
      chatChannelMessageSchema.parse(
        mapChatChannelMessage(message, userContext.userId),
      ),
    );
  });
}
