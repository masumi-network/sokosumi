import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomThreadsMarkAllSchema } from "@/schemas/chat-room.schema";

import {
  markAllChatRoomThreadsRead,
  requireChatRoomUserAccess,
} from "../../../helpers";

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
    path: "/{id}/threads/read",
    description:
      "Mark every unread Thread the current user Participates in for this room (Look). Upserts ChatRoomThreadReadState only — does not change room read state or CHAT notifications. Does not Look lurker Threads.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomThreadsMarkAllSchema,
        "Unread threads marked looked",
      ),
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
    const { id } = c.req.valid("param");

    const room = await requireChatRoomUserAccess(
      id,
      userContext.userId,
      prisma,
    );
    const markedCount = await prisma.$transaction((tx) =>
      markAllChatRoomThreadsRead(room.id, userContext.userId, tx),
    );

    return ok(c, chatRoomThreadsMarkAllSchema.parse({ markedCount }));
  });
}
