import { createRoute } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskBoardResponseSchema } from "@/schemas/task-manager.schema";
import { taskBoardItemInclude } from "@/types/task";

const route = createRoute({
  method: "get",
  path: "/board",
  description: "Retrieve task board grouped by status",
  tags: ["Task Manager"],
  responses: {
    200: jsonSuccessResponse(taskBoardResponseSchema, "Retrieve task board", {
      data: {
        columns: [],
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
  },
});

function mapTaskBoardItem(task: {
  id: string;
  name: string;
  status: TaskStatus;
  orchestrator: {
    id: string;
    slug: string;
    name: string;
    url: string | null;
    email: string | null;
    description: string | null;
    image: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  events: Array<{ createdAt: Date; status: TaskStatus }>;
  _count: { comments: number };
  updatedAt: Date;
}) {
  const lastEvent = task.events[0];
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    orchestrator: task.orchestrator,
    _count: task._count,
    lastEvent: lastEvent
      ? {
          createdAt: lastEvent.createdAt,
          status: lastEvent.status,
        }
      : null,
    updatedAt: task.updatedAt,
  };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;

    const tasks = await prisma.$transaction(async (tx) => {
      return tx.task.findMany({
        where: {
          userId: authContext.userId,
        },
        include: taskBoardItemInclude,
        orderBy: {
          updatedAt: "desc",
        },
      });
    });

    const columns = Object.values(TaskStatus).map((status) => ({
      status,
      tasks: tasks
        .filter((task) => task.status === status)
        .map((task) => mapTaskBoardItem(task)),
    }));

    return ok(c, taskBoardResponseSchema.parse({ columns }));
  });
}
