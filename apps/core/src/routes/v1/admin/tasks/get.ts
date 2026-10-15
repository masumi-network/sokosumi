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
import { buildResponsibleUserMatchingWhere } from "@/helpers/task-visibility";
import {
  mapResponsibleUserWithEmail,
  responsibleUserWithEmailInclude,
} from "@/helpers/work-creator";
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
            // The person the list names as `owner` (ADR 0056).
            buildResponsibleUserMatchingWhere({
              OR: [
                { name: { contains: term, mode: "insensitive" } },
                { email: { contains: term, mode: "insensitive" } },
              ],
            }),
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
          ...responsibleUserWithEmailInclude,
          organization: { select: { id: true, name: true, slug: true } },
        },
      }),
      prisma.task.count({ where }),
    ]);

    const hasMore = tasks.length === takePlusOne;
    const items = tasks.slice(0, take).map((task) => {
      const responsibleUser = mapResponsibleUserWithEmail(task);
      return {
        id: task.id,
        name: task.name,
        status: task.status,
        createdAt: task.createdAt,
        owner: responsibleUser,
        responsibleUser,
        organization: task.organization,
      };
    });

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
