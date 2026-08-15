import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomThreadsAttentionCountSchema } from "@/schemas/chat-room.schema";

import {
  countChatRoomAttentionThreads,
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
    method: "get",
    path: "/{id}/threads/attention-count",
    description:
      "Count attention threads in a room (dual-baseline `attentionReplyCount`, including qualifying never-looked). Cheap Threads-badge path: returns a count only, no thread items. Same eligibility as `unread=true`, thread overview, and Mark all. Independent of room mark-read.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        chatRoomThreadsAttentionCountSchema,
        "Attention thread count",
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
    const count = await countChatRoomAttentionThreads(
      room.id,
      userContext.userId,
      prisma,
    );

    c.header("Cache-Control", "no-store");
    return ok(c, chatRoomThreadsAttentionCountSchema.parse({ count }));
  });
}
