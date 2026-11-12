import { createRoute, z } from "@hono/zod-openapi";
import { calendarDateSchema } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import { requireMutableTaskWriteAccess } from "@/helpers/access-control";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { lockCalendarScope, lockTaskRows } from "@/helpers/calendar-locks";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";

export const MAX_TASK_DUE_DATE_MOVES = 100;

const dueDateMoveSchema = z.object({
  id: z.string().min(1).openapi({ example: "tsk_123" }),
  from: calendarDateSchema.openapi({
    description: "The due day the Task must still have (YYYY-MM-DD).",
    example: "2026-11-10",
  }),
  to: calendarDateSchema.openapi({
    description: "The new due day (YYYY-MM-DD).",
    example: "2026-11-13",
  }),
});

const requestSchema = z
  .object({
    tasks: z.array(dueDateMoveSchema).min(1).max(MAX_TASK_DUE_DATE_MOVES),
  })
  .openapi("MoveTaskDueDatesRequest");

const responseSchema = z
  .object({
    moved: z.array(z.string()).openapi({
      description:
        "Ids of the Tasks whose due day changed. The others were skipped.",
    }),
  })
  .openapi("MoveTaskDueDates");

const route = createRoute({
  method: "post",
  path: "/due-dates",
  description:
    "Move the due days of several Tasks in the active workspace at once. Each Task moves only while it still has its `from` day, so an Undo never overwrites a change someone made since. A Task the caller cannot edit, that is archived, waiting for a vendor grant, in another workspace or changed since is skipped, not an error.",
  tags: ["Tasks"],
  request: {
    body: { content: { "application/json": { schema: requestSchema } } },
  },
  responses: {
    200: jsonSuccessResponse(responseSchema, "Moved due days"),
    422: jsonErrorResponse("Unprocessable Entity"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

function dueDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { tasks } = c.req.valid("json");

    const moved: string[] = [];
    // One transaction per Task, with the same locks as a single due-day
    // PATCH, so one Task that cannot move never holds the others back.
    for (const { id, from, to } of tasks) {
      try {
        const didMove = await prisma.$transaction(async (tx) => {
          const snapshot = await requireMutableTaskWriteAccess(
            userContext,
            id,
            tx,
          );
          if (snapshot.workspaceId !== workspaceId) return false;
          if (
            !(await lockCalendarScope(
              tx,
              workspaceId,
              [snapshot.projectId],
              userContext.userId,
            )) ||
            !(await lockTaskRows(tx, [id]))
          ) {
            return false;
          }
          const task = await requireMutableTaskWriteAccess(userContext, id, tx);
          if (task.workspaceId !== workspaceId) return false;
          if (task.ownerId === userContext.userId) {
            await requireAssignedOrganizationSeat(
              userContext.userId,
              task.organizationId,
              tx,
            );
          }
          const { count } = await tx.task.updateMany({
            where: { id, archivedAt: null, dueOn: dueDay(from) },
            data: { dueOn: dueDay(to) },
          });
          return count === 1;
        });
        if (didMove) moved.push(id);
      } catch (error) {
        // Not found, no seat, parked: this Task is skipped.
        if (!(error instanceof HTTPException)) throw error;
      }
    }

    if (moved.length > 0) await deliverCalendarInvalidationsNow(workspaceId);
    return ok(c, responseSchema.parse({ moved }));
  });
}
