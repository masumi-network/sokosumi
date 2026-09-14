import { createRoute, z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { lockCalendarActor, lockCalendarScope } from "@/helpers/calendar-locks";
import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { deleteProjectBlobs } from "@/lib/project-files-blob";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

const deleteResponseSchema = z
  .object({
    id: z.string().uuid(),
    deleted: z.literal(true),
  })
  .openapi("ProjectDeleted");

const headersSchema = z.object({
  "idempotency-key": z
    .string()
    .uuid()
    .openapi({
      param: { in: "header" },
      description: "Idempotency identity for this Project deletion",
      example: "123e4567-e89b-42d3-a456-426614174000",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/{id}",
    description:
      "Delete a project. Interactive session user only; coworker keys are rejected so X-Context-User-Id cannot destroy projects in another user's workspace.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
      headers: headersSchema,
    },
    responses: {
      200: jsonSuccessResponse(deleteResponseSchema, "Project deleted"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id } = c.req.valid("param");
    const { "idempotency-key": operationId } = c.req.valid("header");

    const deleteOutcome = await serializableTransaction(async (tx) => {
      if (!(await lockCalendarActor(tx, userContext.userId))) {
        return "missing" as const;
      }

      if (!(await lockCalendarScope(tx, workspaceContext.workspaceId, []))) {
        return "missing" as const;
      }

      const replay = await tx.projectDeletionTombstone.findUnique({
        where: {
          workspaceId_operationId: {
            workspaceId: workspaceContext.workspaceId,
            operationId,
          },
        },
        select: { actorUserId: true, projectId: true },
      });
      if (replay) {
        if (
          replay.projectId !== id ||
          replay.actorUserId !== userContext.userId
        ) {
          throw conflict(
            "This idempotency identity was already used for another Project deletion",
            { kind: CORE_API_ERROR_KINDS.IDEMPOTENCY_CONFLICT },
          );
        }
        return "replayed" as const;
      }

      if (!(await lockCalendarScope(tx, workspaceContext.workspaceId, [id]))) {
        return "missing" as const;
      }

      const scheduledTask = await tx.task.findFirst({
        where: {
          projectId: id,
          archivedAt: null,
          OR: [
            { metadata: { not: null } },
            { nextRunAt: { not: null } },
            { scheduleQuarantine: { isNot: null } },
          ],
        },
        select: { id: true },
      });
      const scheduleLink = await tx.taskLink.findFirst({
        where: {
          type: "SCHEDULE",
          OR: [{ fromTask: { projectId: id } }, { toTask: { projectId: id } }],
        },
        select: { id: true },
      });
      const occurrence = await tx.taskScheduleOccurrence.findFirst({
        where: { sourceProjectId: id },
        select: { id: true },
      });
      if (scheduledTask || scheduleLink || occurrence) {
        return "guarded" as const;
      }

      const deleteResult = await tx.project.deleteMany({
        where: {
          id,
          workspaceId: workspaceContext.workspaceId,
          closingAt: null,
          closedAt: null,
          closeOperation: { is: null },
        },
      });
      if (deleteResult.count !== 1) {
        return "guarded" as const;
      }

      await tx.projectDeletionTombstone.create({
        data: {
          workspaceId: workspaceContext.workspaceId,
          projectId: id,
          operationId,
          actorUserId: userContext.userId,
        },
      });

      return "deleted" as const;
    }, "Project changed during deletion");

    if (deleteOutcome === "missing") {
      throw notFound("Project not found");
    }
    if (deleteOutcome === "guarded") {
      throw conflict(
        "Remove or close scheduled work before deleting this Project",
        {
          kind: CORE_API_ERROR_KINDS.PROJECT_HAS_CALENDAR_HISTORY,
        },
      );
    }

    await deliverCalendarInvalidationsNow(workspaceContext.workspaceId);
    await deleteProjectBlobs(id);

    return ok(c, deleteResponseSchema.parse({ id, deleted: true }));
  });
}
