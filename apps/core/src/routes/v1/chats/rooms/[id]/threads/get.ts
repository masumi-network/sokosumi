import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomThreadSchema } from "@/schemas/chat-room.schema";

import { listChatRoomThreads, requireChatRoomUserAccess } from "../../helpers";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

const querySchema = z.object({
  unread: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      param: { name: "unread", in: "query" },
      description:
        "When `true`, only threads with ≥1 unread non-self reply after the look baseline. When omitted or `false`, all roots with ≥1 non-deleted reply.",
      example: "true",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/threads",
    description:
      "List threads in a room. Optional `unread=true` filters to threads needing look. Look baseline is per-thread lastReadAt, else room read-state createdAt, else all history. Independent of room mark-read.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      query: querySchema,
    },
    responses: {
      200: jsonSuccessResponse(z.array(chatRoomThreadSchema), "Threads"),
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
    const { unread } = c.req.valid("query");

    const room = await requireChatRoomUserAccess(
      id,
      userContext.userId,
      prisma,
    );
    const items = await listChatRoomThreads(
      room.id,
      userContext.userId,
      prisma,
      {
        unreadOnly: unread === "true",
      },
    );

    return ok(c, z.array(chatRoomThreadSchema).parse(items));
  });
}
