import { createRoute, z } from "@hono/zod-openapi";
import { assertChatMessageReadBudget } from "@/helpers/chat-message-read-budget";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { mapChatRoomMessage } from "@/routes/v1/chats/rooms/helpers";
import {
  decodeChatDecisionCursor,
  encodeChatDecisionCursor,
} from "@/routes/v1/chats/signals/decisions/get";
import { chatFeedSchema } from "@/schemas/chat-signal.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { listChatFeed } from "@/services/chat-feed.service";

const querySchema = cursorPaginationQuerySchema.extend({
  cursor: z
    .string()
    .optional()
    .openapi({
      param: { name: "cursor", in: "query" },
      description:
        "`nextCursor` from the previous page. It names a position, not a row.",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/",
    description:
      "The viewer's Feed: chat messages that need them, across the unmuted rooms their sidebar lists, Thread replies included. A message is in it when it is from someone else and is a person's message in a Direct, mentions the viewer, is a question or decision Jev addressed to the viewer (readers' corrections applied), or is an agent's answer to a message the viewer sent or was mentioned in, outside a one-person room. Newest first. `unreadCount` counts the unread ones across every page.",
    tags: ["Chat Signals"],
    request: { query: querySchema },
    responses: {
      200: jsonSuccessResponse(chatFeedSchema, "The viewer's Feed"),
      400: jsonErrorResponse("Invalid request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      429: jsonErrorResponse("Chat history read budget exceeded"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId, organizationId } = requireUserAuthContext(
      c.var.authContext,
    );
    const { cursor, limit: take } = c.req.valid("query");
    const after = cursor ? decodeChatDecisionCursor(cursor) : undefined;
    await assertChatMessageReadBudget(userId);
    const page = await listChatFeed(userId, organizationId, { after, take });
    const last = page.items.at(-1)?.message;
    return ok(
      c,
      chatFeedSchema.parse({
        items: page.items.map((item) => ({
          ...item,
          message: mapChatRoomMessage(item.message, userId),
        })),
        nextCursor:
          page.hasMore && last ? encodeChatDecisionCursor(last) : null,
        unreadCount: page.unreadCount,
      }),
    );
  });
}
