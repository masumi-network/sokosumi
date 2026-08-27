import { createRoute, z } from "@hono/zod-openapi";

import { badRequest } from "@/helpers/error";
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
import { chatRoomPinnedMessageListItemSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  requireChatRoomUserMembership,
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
    path: "/{id}/pinned-messages",
    description:
      "List Pinned messages for a Channel, newest pin first. Directs are rejected.",
    tags: ["Chat Rooms"],
    request: {
      params: paramsSchema,
      query: cursorPaginationQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(chatRoomPinnedMessageListItemSchema),
        "Pinned messages retrieved",
      ),
      400: jsonErrorResponse("Invalid request"),
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
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const takePlusOne = take + 1;

    const room = await requireChatRoomUserMembership(
      id,
      userContext.userId,
      prisma,
    );
    if (room.kind !== "channel") {
      throw badRequest("Only Channels can have pinned messages.");
    }

    const [pins, count] = await Promise.all([
      prisma.chatRoomPinnedMessage.findMany({
        where: { roomId: id },
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ pinnedAt: "desc" }, { id: "desc" }],
        include: {
          pinnedByUser: { select: { id: true, name: true } },
          message: { include: chatRoomMessageInclude },
        },
      }),
      prisma.chatRoomPinnedMessage.count({ where: { roomId: id } }),
    ]);

    const hasMore = pins.length === takePlusOne;
    const pagePins = pins.slice(0, take);
    const paginationMeta = createPaginationMeta(
      pagePins,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(
      c,
      z.array(chatRoomPinnedMessageListItemSchema).parse(
        pagePins.map((pin) => {
          const messageDeleted = pin.message.deletedAt != null;
          return {
            messageId: pin.messageId,
            pinnedAt: pin.pinnedAt,
            pinnedBy: pin.pinnedByUser
              ? { id: pin.pinnedByUser.id, name: pin.pinnedByUser.name }
              : null,
            message: messageDeleted
              ? null
              : mapChatRoomMessage(pin.message, userContext.userId),
          };
        }),
      ),
      paginationMeta,
    );
  });
}
