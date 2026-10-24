import { createRoute, z } from "@hono/zod-openapi";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { parseCursorPagination } from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { mapChatRoomMessage } from "@/routes/v1/chats/rooms/helpers";
import { chatRoomMessageSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { listChatRoomMessagesWithTag } from "@/services/chat-signal-views.service";
import { roomParamsSchema } from "../../../params";

const querySchema = cursorPaginationQuerySchema.extend({
  cursor: z
    .string()
    .uuid()
    .optional()
    .openapi({
      param: { name: "cursor", in: "query" },
      description: "The last message id of the previous page (`nextCursor`).",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/rooms/{id}/decisions",
    description:
      "The room's decision log: messages Jev read as a decision made (chat signals), with readers' corrections applied. Newest first.",
    tags: ["Chat Signals"],
    request: { params: roomParamsSchema, query: querySchema },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(chatRoomMessageSchema),
        "Decisions in the room",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Room not found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { cursor, take } = parseCursorPagination(c.req.valid("query"));
    const page = await listChatRoomMessagesWithTag(id, userId, "decisionMade", {
      cursor,
      take,
    });
    return ok(
      c,
      z
        .array(chatRoomMessageSchema)
        .parse(
          page.messages.map((message) => mapChatRoomMessage(message, userId)),
        ),
      {
        cursor: cursor ?? null,
        limit: take,
        total: page.total,
        nextCursor: page.nextCursor,
      },
    );
  });
}
