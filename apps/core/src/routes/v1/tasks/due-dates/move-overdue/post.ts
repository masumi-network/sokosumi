import { createRoute, z } from "@hono/zod-openapi";
import { type Prisma, TaskStatus } from "@sokosumi/database";

import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { buildHumanTaskVisibilityWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";

import {
  dueDay,
  dueDaySchema,
  dueDayString,
  eachLockedTask,
  MAX_DUE_DATE_MOVES,
} from "../each-locked-task";

/** Work a due day no longer presses on, or that waits on a vendor grant. */
const NOT_MOVABLE = [
  TaskStatus.COMPLETED,
  TaskStatus.CANCELED,
  TaskStatus.GRANT_PENDING,
];

const requestSchema = z
  .object({
    today: dueDaySchema.openapi({
      description: "The caller's own calendar day (YYYY-MM-DD).",
      example: "2026-11-12",
    }),
    to: dueDaySchema.openapi({
      description: "The new due day; today or later (YYYY-MM-DD).",
      example: "2026-11-13",
    }),
  })
  .refine((body) => body.to >= body.today, {
    message: "to must be today or later",
    path: ["to"],
  })
  .openapi("MoveOverdueTasksRequest");

const movedTaskSchema = z.object({
  id: z.string(),
  from: z.string().openapi({
    description: "The due day the Task had before (YYYY-MM-DD).",
    example: "2026-11-02",
  }),
  version: z.string().openapi({
    description:
      "The Task's `updatedAt` right after the move. Undo needs it, so it puts the Task back only if nothing changed since.",
    example: "2026-11-12T09:30:00.123Z",
  }),
});

const responseSchema = z
  .object({
    moved: z.array(movedTaskSchema),
    skipped: z.number().int().openapi({
      description:
        "Overdue Tasks that changed meanwhile, could not be edited or failed, and kept their due day.",
    }),
  })
  .openapi("MoveOverdueTasks");

const route = createRoute({
  method: "post",
  path: "/due-dates/move-overdue",
  description: `Move the caller's overdue Tasks in the active workspace to a new due day: open Tasks they own or are assigned, due before \`today\`, oldest first, at most ${MAX_DUE_DATE_MOVES}. Each Task is checked again under lock, so one finished, reassigned or re-dated in the meantime keeps its day.`,
  tags: ["Tasks"],
  request: {
    body: { content: { "application/json": { schema: requestSchema } } },
  },
  responses: {
    200: jsonSuccessResponse(responseSchema, "Moved overdue Tasks"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

/** Still the caller's open, overdue Task: what a forward move may re-date. */
export function overdueTaskWhere(
  userId: string,
  workspaceId: string,
  today: string,
): Prisma.TaskWhereInput {
  return {
    workspaceId,
    archivedAt: null,
    dueOn: { lt: dueDay(today) },
    status: { notIn: NOT_MOVABLE },
    AND: [
      buildHumanTaskVisibilityWhere(userId),
      { OR: [{ ownerId: userId }, { assigneeUserId: userId }] },
    ],
  };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { today, to } = c.req.valid("json");
    const where = overdueTaskWhere(userContext.userId, workspaceId, today);

    const candidates = await prisma.task.findMany({
      where,
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
      take: MAX_DUE_DATE_MOVES,
      select: { id: true },
    });
    const { done, skipped } = await eachLockedTask(
      candidates.map((task) => task.id),
      { userContext, workspaceId },
      async (tx, task) => {
        // Checked again under lock: finished, reassigned or re-dated
        // meanwhile means this Task is no longer the caller's to move.
        if (!task.dueOn) return null;
        const { count } = await tx.task.updateMany({
          where: { ...where, id: task.id, dueOn: task.dueOn },
          data: { dueOn: dueDay(to) },
        });
        if (count !== 1) return null;
        const { updatedAt } = await tx.task.findUniqueOrThrow({
          where: { id: task.id },
          select: { updatedAt: true },
        });
        return {
          id: task.id,
          from: dueDayString(task.dueOn),
          version: updatedAt.toISOString(),
        };
      },
    );

    if (done.length > 0) await deliverCalendarInvalidationsNow(workspaceId);
    return ok(c, responseSchema.parse({ moved: done, skipped }));
  });
}
