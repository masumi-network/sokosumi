import { createRoute, z } from "@hono/zod-openapi";
import { type Prisma, TaskLinkType } from "@sokosumi/database";

import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTaskLinkPeerTask } from "@/helpers/task-link";
import {
  buildTaskPlan,
  TASK_PLAN_MAX_DEPTH,
  type TaskPlanEdge,
} from "@/helpers/task-plan";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskPlanSchema } from "@/schemas/task-link.schema";
import {
  buildVisiblePeerTaskWhere,
  taskLinkPeerTaskSelect,
} from "@/types/task-link";

/** Links read per level; more marks the plan truncated. */
const LINKS_PER_LEVEL = 200;

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/plan",
  description:
    "Blockers and sub-tasks around this task, up to three links deep, as depth-first rows. Only open tasks the caller can see.",
  tags: ["Tasks"],
  request: { params: paramsSchema },
  responses: {
    200: jsonSuccessResponse(taskPlanSchema, "Task plan"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

/**
 * One query per level: sub-tasks (PARENT links from the Task) and blockers
 * (BLOCKS links to it), peers filtered to what the reader may see. Reads one
 * level past the depth limit so the deepest rows know whether more exists.
 */
async function loadPlanEdges(rootId: string, visible: Prisma.TaskWhereInput) {
  const edgesByTask = new Map<string, TaskPlanEdge[]>();
  const read = new Set<string>();
  let frontier = [rootId];
  let capped = false;

  for (
    let level = 0;
    level <= TASK_PLAN_MAX_DEPTH && frontier.length;
    level++
  ) {
    for (const id of frontier) read.add(id);
    const links = await prisma.taskLink.findMany({
      where: {
        OR: [
          {
            type: TaskLinkType.PARENT,
            fromTaskId: { in: frontier },
            toTask: { is: visible },
          },
          {
            type: TaskLinkType.BLOCKS,
            toTaskId: { in: frontier },
            fromTask: { is: visible },
          },
        ],
      },
      select: {
        fromTaskId: true,
        toTaskId: true,
        type: true,
        fromTask: { select: taskLinkPeerTaskSelect },
        toTask: { select: taskLinkPeerTaskSelect },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: LINKS_PER_LEVEL + 1,
    });
    if (links.length > LINKS_PER_LEVEL) capped = true;

    const next = new Set<string>();
    for (const link of links.slice(0, LINKS_PER_LEVEL)) {
      const subTask = link.type === TaskLinkType.PARENT;
      const taskId = subTask ? link.fromTaskId : link.toTaskId;
      const peer = subTask ? link.toTask : link.fromTask;
      const edges = edgesByTask.get(taskId) ?? [];
      edges.push({ relation: subTask ? "parent" : "blocked_by", peer });
      edgesByTask.set(taskId, edges);
      if (!read.has(peer.id)) next.add(peer.id);
    }
    frontier = [...next];
  }

  return { edgesByTask, capped };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    await requireTaskReadForRouteVars(c.var, id, prisma);
    const root = await prisma.task.findUnique({
      where: { id, archivedAt: null },
      select: { id: true },
    });
    if (!root) {
      throw notFound("Task not found");
    }

    const visible: Prisma.TaskWhereInput = {
      AND: [
        buildVisiblePeerTaskWhere(
          c.var.authContext,
          c.var.workspaceContext?.workspaceId,
        ),
        { archivedAt: null },
      ],
    };
    const { edgesByTask, capped } = await loadPlanEdges(root.id, visible);
    const plan = buildTaskPlan(root.id, edgesByTask);

    return ok(c, {
      truncated: plan.truncated || capped,
      items: plan.items.map((item) => ({
        ...item,
        task: mapTaskLinkPeerTask(item.task),
      })),
    });
  });
}
