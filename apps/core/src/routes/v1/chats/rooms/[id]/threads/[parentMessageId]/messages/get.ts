import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  requireChatRoomUserMembership,
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
    method: "get",
    path: "/{id}/threads/{parentMessageId}/messages",
    description:
      "List replies for a thread root. Parent must be a top-level message in the room.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      query: cursorPaginationQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(chatRoomMessageSchema),
        "Thread messages retrieved",
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
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const takePlusOne = take + 1;

    await requireChatRoomUserMembership(id, userContext.userId, prisma);

    const parent = await prisma.chatRoomMessage.findFirst({
      where: {
        id: parentMessageId,
        roomId: id,
        parentMessageId: null,
      },
      select: { id: true },
    });
    if (!parent) {
      throw notFound("Thread not found");
    }

    const where = {
      roomId: id,
      parentMessageId: parent.id,
    };

    const [messages, count] = await Promise.all([
      prisma.chatRoomMessage.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: chatRoomMessageInclude,
      }),
      prisma.chatRoomMessage.count({ where }),
    ]);

    const hasMore = messages.length === takePlusOne;
    const pageMessages = messages.slice(0, take);
    const paginationMeta = createPaginationMeta(
      pageMessages,
      count,
      take,
      hasMore,
      cursor,
    );
    const orderedMessages = [...pageMessages].reverse();

    return ok(
      c,
      z
        .array(chatRoomMessageSchema)
        .parse(
          orderedMessages.map((message) =>
            mapChatRoomMessage(message, userContext.userId),
          ),
        ),
      paginationMeta,
    );
  });
}
