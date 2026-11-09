import { createRoute, z } from "@hono/zod-openapi";

import { assertChatMessageReadBudget } from "@/helpers/chat-message-read-budget";
import { badRequest } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { createPaginationMeta } from "@/helpers/pagination";
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

const querySchema = cursorPaginationQuerySchema.extend({
  cursor: z
    .string()
    .optional()
    .openapi({
      param: { name: "cursor", in: "query" },
      description:
        "`nextCursor` from the previous page. It names a position, not a row, so removing that save does not lose the rest of the list.",
    }),
});

/** A page boundary as values: `<savedAt ISO>_<save id>`. */
export function encodeSavedMessageCursor(save: {
  savedAt: Date;
  id: string;
}): string {
  return `${save.savedAt.toISOString()}_${save.id}`;
}

export function decodeSavedMessageCursor(cursor: string): {
  savedAt: Date;
  id: string;
} {
  const [iso, id] = cursor.split("_");
  const savedAt = new Date(iso ?? "");
  if (
    !id ||
    Number.isNaN(savedAt.getTime()) ||
    !z.uuid().safeParse(id).success
  ) {
    throw badRequest("cursor is invalid");
  }
  return { savedAt, id };
}

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/",
    description:
      "The reader's Saved list, newest save first: only messages in rooms this sidebar lists that the reader is still a member of, and not deleted. Content is read live from each message, so a lost membership or a deleted message drops out.",
    tags: ["Chat Rooms"],
    request: { query: querySchema },
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

/**
 * The saves the reader can still read, in this workspace's sidebar, after
 * `after` when given. `after` is a position, not a row, so it holds when that
 * save is gone.
 */
export function readableSavedMessageWhere(
  userId: string,
  organizationId: string | null | undefined,
  after?: { savedAt: Date; id: string } | null,
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
    ...(after
      ? {
          OR: [
            { savedAt: { lt: after.savedAt } },
            { savedAt: after.savedAt, id: { lt: after.id } },
          ],
        }
      : {}),
  };
}

export const SAVED_MESSAGE_ORDER = [
  { savedAt: "desc" as const },
  { id: "desc" as const },
];

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { cursor, limit: take } = c.req.valid("query");
    const after = cursor ? decodeSavedMessageCursor(cursor) : null;
    await assertChatMessageReadBudget(userContext.userId);

    const [saves, count] = await Promise.all([
      prisma.chatRoomSavedMessage.findMany({
        where: readableSavedMessageWhere(
          userContext.userId,
          userContext.organizationId,
          after,
        ),
        take: take + 1,
        orderBy: SAVED_MESSAGE_ORDER,
        include: { message: { include: chatRoomMessageInclude } },
      }),
      prisma.chatRoomSavedMessage.count({
        where: readableSavedMessageWhere(
          userContext.userId,
          userContext.organizationId,
        ),
      }),
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
      createPaginationMeta(
        page,
        count,
        take,
        hasMore,
        cursor,
        encodeSavedMessageCursor,
      ),
    );
  });
}
