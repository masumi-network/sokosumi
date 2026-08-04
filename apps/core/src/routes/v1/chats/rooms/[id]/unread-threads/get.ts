import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomUnreadThreadSchema } from "@/schemas/chat-room.schema";

import {
  listChatRoomUnreadThreads,
  requireChatRoomUserAccess,
} from "../../helpers";

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
    method: "get",
    path: "/{id}/unread-threads",
    description:
      "List top-level messages in a room that have unread thread replies for the current user. Look baseline is per-thread lastReadAt, else room read-state createdAt, else all history. Independent of room mark-read.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(chatRoomUnreadThreadSchema),
        "Unread threads",
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
    const items = await listChatRoomUnreadThreads(
      room.id,
      userContext.userId,
      prisma,
    );

    return ok(c, z.array(chatRoomUnreadThreadSchema).parse(items));
  });
}
