import { createRoute, z } from "@hono/zod-openapi";

import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";

import {
  dueDay,
  dueDaySchema,
  eachLockedTask,
  MAX_DUE_DATE_MOVES,
} from "../each-locked-task";

const requestSchema = z
  .object({
    to: dueDaySchema.openapi({
      description: "The due day the move gave the Tasks (YYYY-MM-DD).",
      example: "2026-11-13",
    }),
    tasks: z
      .array(
        z.object({
          id: z.string().min(1),
          from: dueDaySchema.openapi({
            description: "The due day to put back (YYYY-MM-DD).",
            example: "2026-11-02",
          }),
          // A plain string, not `.datetime()`, so the generated client keeps
          // the exact value the move returned instead of a Date.
          version: z
            .string()
            .refine((value) => !Number.isNaN(Date.parse(value)), {
              message: "version must be a timestamp",
            })
            .openapi({
              description: "The `version` the move returned for this Task.",
              example: "2026-11-12T09:30:00.123Z",
            }),
        }),
      )
      .min(1)
      .max(MAX_DUE_DATE_MOVES),
  })
  .openapi("UndoMoveOverdueTasksRequest");

const responseSchema = z
  .object({
    restored: z.array(z.string()).openapi({
      description: "Ids of the Tasks put back on their old due day.",
    }),
    skipped: z.number().int().openapi({
      description:
        "Tasks that changed in any way since the move, or could not be edited, and were left as they are.",
    }),
  })
  .openapi("UndoMoveOverdueTasks");

const route = createRoute({
  method: "post",
  path: "/due-dates/undo",
  description:
    "Undo a move of overdue Tasks. Each Task goes back to its old due day only while it is untouched since the move: same `version` (its `updatedAt`) and still on `to`. Any later change, even one back to the same day, keeps the Task as it is.",
  tags: ["Tasks"],
  request: {
    body: { content: { "application/json": { schema: requestSchema } } },
  },
  responses: {
    200: jsonSuccessResponse(responseSchema, "Undid the move"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { to, tasks } = c.req.valid("json");
    const byId = new Map(tasks.map((task) => [task.id, task]));

    const { done, skipped } = await eachLockedTask(
      [...byId.keys()],
      { userContext, workspaceId },
      async (tx, task) => {
        const undo = byId.get(task.id);
        if (!undo) return null;
        const { count } = await tx.task.updateMany({
          where: {
            id: task.id,
            workspaceId,
            archivedAt: null,
            dueOn: dueDay(to),
            updatedAt: new Date(undo.version),
          },
          data: { dueOn: dueDay(undo.from) },
        });
        return count === 1 ? task.id : null;
      },
    );

    if (done.length > 0) await deliverCalendarInvalidationsNow(workspaceId);
    return ok(c, responseSchema.parse({ restored: done, skipped }));
  });
}
