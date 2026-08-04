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
import { chatRoomThreadSchema } from "@/schemas/chat-room.schema";

import { getChatRoomThread, requireChatRoomUserAccess } from "../../../helpers";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
  parentMessageId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "parentMessageId", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440001",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/threads/{parentMessageId}",
    description:
      "Get one thread summary by root parent message id. 404 when missing, not a root, soft-deleted, or has no replies.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(chatRoomThreadSchema, "Thread"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Thread not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id, parentMessageId } = c.req.valid("param");

    const room = await requireChatRoomUserAccess(
      id,
      userContext.userId,
      prisma,
    );
    const thread = await getChatRoomThread(
      room.id,
      userContext.userId,
      parentMessageId,
      prisma,
    );
    if (!thread) {
      throw notFound("Thread not found");
    }

    return ok(c, chatRoomThreadSchema.parse(thread));
  });
}
