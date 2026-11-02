import { createRoute, z } from "@hono/zod-openapi";
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
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { directReachableUserWhere } from "@/routes/v1/chats/rooms/helpers";
import { chatPersonSchema } from "@/schemas/chat-room.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listChatPeople",
  tags: ["Chat Rooms"],
  description:
    "List everyone the signed-in user may start a Personal Direct with: members of any of their Organizations and co-members of any External channel they are on, each once, sorted by name, paginated. Independent of the active workspace.",
  request: { query: cursorPaginationQuerySchema },
  responses: {
    200: jsonPaginatedSuccessResponse(z.array(chatPersonSchema), "People"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { cursor, take, skip } = parseCursorPagination(c.req.valid("query"));
    const where = { id: { not: userId }, ...directReachableUserWhere(userId) };
    const [people, count] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: { id: true, name: true, email: true, image: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: take + 1,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
      }),
      prisma.user.count({ where }),
    ]);
    const hasMore = people.length > take;
    const page = people.slice(0, take);
    return ok(
      c,
      z.array(chatPersonSchema).parse(page),
      createPaginationMeta(page, count, take, hasMore, cursor),
    );
  });
}
