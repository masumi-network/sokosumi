import { createRoute } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

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
import {
  adminTaskListQuerySchema,
  adminTaskListSchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminTasks",
  description:
    "Paginated list of all tasks, searchable by task ID, task name, user, or organization (admin only).",
  tags: ["Admin"],
  request: {
    query: adminTaskListQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      adminTaskListSchema,
      "Paginated list of tasks for the admin task list",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const term = queryParams.query?.trim();

    const where: Prisma.TaskWhereInput = term
      ? {
          OR: [
            { id: term },
            { name: { contains: term, mode: "insensitive" } },
            {
              owner: {
                OR: [
                  { name: { contains: term, mode: "insensitive" } },
                  { email: { contains: term, mode: "insensitive" } },
                ],
              },
            },
            {
              organization: {
                OR: [
                  { name: { contains: term, mode: "insensitive" } },
                  { slug: { contains: term, mode: "insensitive" } },
                ],
              },
            },
          ],
        }
      : {};

    const takePlusOne = take + 1;
    const [tasks, total] = await prisma.$transaction([
      prisma.task.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          owner: { select: { id: true, name: true, email: true } },
          organization: { select: { id: true, name: true, slug: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);

    const hasMore = tasks.length === takePlusOne;
    const items = tasks.slice(0, take).map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status,
      createdAt: task.createdAt,
      owner: task.owner,
      // Deprecated alias — keep until admin clients migrate.
      user: task.owner,
      organization: task.organization,
    }));

    const paginationMeta = createPaginationMeta(
      items,
      total,
      take,
      hasMore,
      cursor,
    );

    return ok(c, adminTaskListSchema.parse(items), paginationMeta);
  });
}
