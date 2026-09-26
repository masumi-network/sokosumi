import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomThreadsUnreadCountSchema } from "@/schemas/chat-room.schema";

import { requireChatRoomUserAccess } from "../../../helpers";
import { getChatRoomThreadAggregates } from "../../../room-unread";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/threads/unread-count",
    description:
      "Unread threads in a room with each one's Participant-gated `unreadReplyCount`, and their count. No parent messages are hydrated. Same eligibility as `unread=true` and Mark all. Independent of room mark-read.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomThreadsUnreadCountSchema,
        "Unread thread count",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
      422: jsonErrorResponse("Unprocessable Entity"),
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
    const aggregates = await getChatRoomThreadAggregates(
      room.id,
      userContext.userId,
      prisma,
      { unreadOnly: true },
    );
    const threads = aggregates.map(({ parentMessageId, unreadReplyCount }) => ({
      parentMessageId,
      unreadReplyCount,
    }));

    c.header("Cache-Control", "no-store");
    return ok(
      c,
      chatRoomThreadsUnreadCountSchema.parse({
        count: threads.length,
        threads,
      }),
    );
  });
}
