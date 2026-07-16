import { createRoute } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import {
  subscriptionRepository,
  userRepository,
} from "@sokosumi/database/repositories";

import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import { getCredits } from "@/helpers/user";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminUserOverviewListSchema,
  adminUserOverviewQuerySchema,
} from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminUsers",
  description:
    "Paginated overview of all users with available credits, active subscription, and started-task counts (admin only).",
  tags: ["Admin"],
  request: {
    query: adminUserOverviewQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      adminUserOverviewListSchema,
      "Paginated list of users for the admin overview",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    const { users, total } = await userRepository.listUsersForAdminOverview(
      { query: queryParams.query, cursor, take: take + 1, skip },
      prisma,
    );

    const hasMore = users.length === take + 1;
    const pageUsers = users.slice(0, take);
    const userIds = pageUsers.map((user) => user.id);

    const [credits, subscriptions, taskCounts] = await Promise.all([
      Promise.all(userIds.map((userId) => getCredits(userId, null, prisma))),
      Promise.all(
        userIds.map((userId) =>
          subscriptionRepository.resolveActiveSubscriptionByReferenceId(
            userId,
            prisma,
          ),
        ),
      ),
      userIds.length > 0
        ? prisma.task.groupBy({
            by: ["userId"],
            where: {
              userId: { in: userIds },
              status: { not: TaskStatus.DRAFT },
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

    const taskCountByUserId = new Map(
      taskCounts.map((row) => [row.userId, row._count._all]),
    );

    const items = pageUsers.map((user, index) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      credits: credits[index] ?? 0,
      subscriptionPlan: subscriptions[index]?.plan ?? null,
      subscriptionStatus: subscriptions[index]?.status ?? null,
      startedTaskCount: taskCountByUserId.get(user.id) ?? 0,
    }));

    const paginationMeta = createPaginationMeta(
      pageUsers,
      total,
      take,
      hasMore,
      cursor,
    );

    return ok(c, adminUserOverviewListSchema.parse(items), paginationMeta);
  });
}
