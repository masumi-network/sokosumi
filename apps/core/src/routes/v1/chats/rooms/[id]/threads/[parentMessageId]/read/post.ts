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

import {
  markChatRoomThreadRead,
  requireChatRoomUserAccess,
} from "../../../../helpers";

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
    method: "post",
    path: "/{id}/threads/{parentMessageId}/read",
    description:
      "Mark a thread root as looked for the current user (ThreadPanel open). Upserts ChatRoomThreadReadState only — does not change room read state or CHAT notifications.",
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
    const state = await markChatRoomThreadRead(
      room.id,
      userContext.userId,
      parentMessageId,
      prisma,
    );
    if (!state) {
      throw notFound("Thread not found");
    }

    return ok(c, chatRoomThreadReadStateSchema.parse(state));
  });
}
