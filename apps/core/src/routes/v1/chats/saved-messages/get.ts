import { createRoute, z } from "@hono/zod-openapi";

import { assertChatMessageReadBudget } from "@/helpers/chat-message-read-budget";
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
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { chatSavedMessageListItemSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

import {
  chatRoomMessageInclude,
  mapChatRoomMessage,
  membershipVisibleActiveRoomWhere,
  withChatRoomReplyCounts,
} from "../rooms/helpers";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/",
    description:
      "The reader's Saved list, newest save first: only messages in rooms this sidebar lists that the reader is still a member of, and not deleted. Content is read live from each message, so a lost membership or a deleted message drops out.",
    tags: ["Chat Rooms"],
    request: { query: cursorPaginationQuerySchema },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(chatSavedMessageListItemSchema),
        "Saved messages retrieved",
      ),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      429: jsonErrorResponse("Chat history read budget exceeded"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

/** The saves the reader can still read, in this workspace's sidebar. */
export function readableSavedMessageWhere(
  userId: string,
  organizationId: string | null | undefined,
) {
  return {
    userId,
    message: {
      deletedAt: null,
      room: {
        ...membershipVisibleActiveRoomWhere(organizationId),
        userMembers: { some: { userId } },
      },
    },
  };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { cursor, take, skip } = parseCursorPagination(c.req.valid("query"));
    await assertChatMessageReadBudget(userContext.userId);

    const where = readableSavedMessageWhere(
      userContext.userId,
      userContext.organizationId,
    );
    const [saves, count] = await Promise.all([
      prisma.chatRoomSavedMessage.findMany({
        where,
        take: take + 1,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ savedAt: "desc" }, { id: "desc" }],
        include: { message: { include: chatRoomMessageInclude } },
      }),
      prisma.chatRoomSavedMessage.count({ where }),
    ]);

    const hasMore = saves.length > take;
    const page = saves.slice(0, take);
    const messages = await withChatRoomReplyCounts(
      prisma,
      page.map((save) => save.message),
    );

    return ok(
      c,
      z.array(chatSavedMessageListItemSchema).parse(
        page.map((save, index) => ({
          messageId: save.messageId,
          savedAt: save.savedAt,
          message: mapChatRoomMessage(messages[index], userContext.userId),
        })),
      ),
      createPaginationMeta(page, count, take, hasMore, cursor),
    );
  });
}
