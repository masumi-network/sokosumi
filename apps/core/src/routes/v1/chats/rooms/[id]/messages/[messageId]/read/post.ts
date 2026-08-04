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
import { chatRoomThreadReadStateSchema } from "@/schemas/chat-room.schema";

import { requireChatRoomUserAccess } from "../../../../helpers";

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
      example: "550e8400-e29b-41d4-a716-446655440001",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/messages/{messageId}/read",
    description:
      "Mark a top-level room message as looked for the current user (ThreadPanel open). Upserts ChatRoomThreadReadState only — does not change room read state or CHAT notifications.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomThreadReadStateSchema,
        "Thread marked looked",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room or message not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id, messageId } = c.req.valid("param");
    const readAt = new Date();

    const room = await requireChatRoomUserAccess(
      id,
      userContext.userId,
      prisma,
    );

    const parent = await prisma.chatRoomMessage.findFirst({
      where: {
        id: messageId,
        roomId: room.id,
        parentMessageId: null,
      },
      select: { id: true },
    });

    if (!parent) {
      throw notFound("Message not found");
    }

    const state = await prisma.chatRoomThreadReadState.upsert({
      where: {
        userId_parentMessageId: {
          userId: userContext.userId,
          parentMessageId: parent.id,
        },
      },
      update: { lastReadAt: readAt },
      create: {
        userId: userContext.userId,
        parentMessageId: parent.id,
        lastReadAt: readAt,
      },
    });

    return ok(
      c,
      chatRoomThreadReadStateSchema.parse({
        parentMessageId: state.parentMessageId,
        lastReadAt: state.lastReadAt,
      }),
    );
  });
}
