import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskAccess } from "@/helpers/access-control";
import { jsonErrorResponse, jsonPaginatedSuccessResponse } from "@/helpers/openapi";
import { createPaginationMeta, parseCursorPagination } from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import { mapTaskComment } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { taskCommentSchema } from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const query = cursorPaginationQuerySchema;

const route = createRoute({
  method: "get",
  path: "/{id}/comments",
  description: "List task comments",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    query,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      z.array(taskCommentSchema),
      "Retrieve task comments",
      {
        data: [
          {
            id: "com_123",
            createdAt: "2025-01-01T00:00:00.000Z",
            updatedAt: "2025-01-01T00:00:00.000Z",
            content: "Looks good.",
            userId: "user_123",
            orchestratorId: null,
            attachments: [],
          },
        ],
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
          pagination: {
            cursor: null,
            limit: 20,
            total: 1,
            nextCursor: null,
          },
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    const commentsWithCount = await prisma.$transaction(async (tx) => {
      await requireTaskAccess(authContext, id, tx);

      const takePlusOne = take + 1;

      const [comments, count] = await Promise.all([
        tx.taskComment.findMany({
          where: { taskId: id },
          take: takePlusOne,
          skip,
          cursor: cursor ? { id: cursor } : undefined,
          include: { attachments: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        tx.taskComment.count({
          where: { taskId: id },
        }),
      ]);

      return { comments, count };
    });

    const hasMore = commentsWithCount.comments.length === take + 1;
    const mappedComments = commentsWithCount.comments
      .slice(0, take)
      .map((comment) => mapTaskComment(comment));
    const paginationMeta = createPaginationMeta(
      mappedComments,
      commentsWithCount.count,
      take,
      hasMore,
      cursor,
    );

    return ok(
      c,
      z.array(taskCommentSchema).parse(mappedComments),
      paginationMeta,
    );
  });
}
