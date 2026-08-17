import { createRoute, z } from "@hono/zod-openapi";

import { unprocessableEntity } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { parseCursorPagination } from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomThreadSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

import {
  listChatRoomThreadListPage,
  listChatRoomThreads,
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

const querySchema = cursorPaginationQuerySchema.extend({
  unread: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      param: { name: "unread", in: "query" },
      description:
        "When `true`, only attention threads (`attentionReplyCount >= 1`, dual-baseline including qualifying never-looked). `cursor` and `limit` are ignored. When omitted or `false`, attention threads first then a recency page of the rest.",
      example: "true",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/threads",
    description:
      "List threads in a room. `unread=true` returns every attention thread (dual-baseline `attentionReplyCount`, including qualifying never-looked) and ignores `cursor`/`limit`. Otherwise returns attention threads first then a recency page of the rest (`cursor`/`limit`). Independent of room mark-read.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      query: querySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(chatRoomThreadSchema),
        "Threads",
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
    const query = c.req.valid("query");
    const unreadOnly = query.unread === "true";

    const room = await requireChatRoomUserAccess(
      id,
      userContext.userId,
      prisma,
    );

    if (unreadOnly) {
      const items = await listChatRoomThreads(
        room.id,
        userContext.userId,
        prisma,
        { unreadOnly: true },
      );
      const parsed = z.array(chatRoomThreadSchema).parse(items);
      return ok(c, parsed, {
        cursor: null,
        limit: parsed.length,
        total: parsed.length,
        nextCursor: null,
      });
    }

    const { cursor, take } = parseCursorPagination(query);
    if (cursor != null && !z.string().uuid().safeParse(cursor).success) {
      throw unprocessableEntity("Invalid cursor");
    }
    const page = await listChatRoomThreadListPage(
      room.id,
      userContext.userId,
      prisma,
      { cursor, limit: take },
    );
    return ok(c, z.array(chatRoomThreadSchema).parse(page.items), {
      cursor: cursor ?? null,
      limit: take,
      total: page.total,
      nextCursor: page.nextCursor,
    });
  });
}
