import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatChannelSchema } from "@/schemas/chat-channel.schema";

import { mapChatChannel, requireChatChannelUserAccess } from "../../helpers";

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
    path: "/{id}/read",
    description:
      "Mark an organization chat channel as read for the current user.",
    tags: ["Chat Channels"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatChannelSchema, "Chat channel marked read"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Channel not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const readAt = new Date();

    const channel = await prisma.$transaction(async (tx) => {
      const channel = await requireChatChannelUserAccess(
        id,
        userContext.userId,
        tx,
      );

      await tx.chatChannelReadState.upsert({
        where: {
          channelId_userId: {
            channelId: channel.id,
            userId: userContext.userId,
          },
        },
        update: { lastReadAt: readAt },
        create: {
          channelId: channel.id,
          userId: userContext.userId,
          lastReadAt: readAt,
        },
      });

      return channel;
    });

    return ok(
      c,
      chatChannelSchema.parse(mapChatChannel(channel, userContext.userId, 0)),
    );
  });
}
