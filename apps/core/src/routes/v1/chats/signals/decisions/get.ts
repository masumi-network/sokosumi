import { createRoute, z } from "@hono/zod-openapi";
import { assertChatMessageReadBudget } from "@/helpers/chat-message-read-budget";
import { badRequest } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { createPaginationMeta } from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { mapChatRoomMessage } from "@/routes/v1/chats/rooms/helpers";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { listChatDecisions } from "@/services/chat-signal-views.service";

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

/** A page boundary as values: `<createdAt ISO>_<message id>`. */
export function encodeChatDecisionCursor(message: {
  createdAt: Date;
  id: string;
}): string {
  return `${message.createdAt.toISOString()}_${message.id}`;
}

export function decodeChatDecisionCursor(cursor: string): {
  createdAt: Date;
  id: string;
} {
  const [iso, id] = cursor.split("_");
  const createdAt = new Date(iso ?? "");
  if (
    !id ||
    Number.isNaN(createdAt.getTime()) ||
    !z.uuid().safeParse(id).success
  ) {
    throw badRequest("cursor is invalid");
  }
  return { createdAt, id };
}

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/decisions",
    description:
      "Decisions across every room the viewer's sidebar lists, read or not, muted rooms and Thread replies included: messages Jev read as a decision made (chat signals), with readers' corrections applied. Deleted messages and rooms the viewer left drop out. Newest first.",
    tags: ["Chat Signals"],
    request: { query: querySchema },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(chatRoomMessageSchema),
        "Decisions across the viewer's rooms",
      ),
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
    const page = await listChatDecisions(userId, organizationId, {
      after,
      take,
    });
    return ok(
      c,
      z
        .array(chatRoomMessageSchema)
        .parse(
          page.messages.map((message) => mapChatRoomMessage(message, userId)),
        ),
      createPaginationMeta(
        page.messages,
        page.total,
        take,
        page.hasMore,
        cursor,
        encodeChatDecisionCursor,
      ),
    );
  });
}
