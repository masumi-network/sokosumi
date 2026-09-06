import { createRoute, z } from "@hono/zod-openapi";
import { isNmkrEmail } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { badRequest, forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { created } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import {
  findTaskProjectInWorkspace,
  healProjectBriefingUrl,
  resolveTaskDescriptionWithContext,
} from "@/helpers/task-create-context";
import { resolveTaskName } from "@/helpers/task-name";
import { TaskScheduleOccurrenceLimitError } from "@/helpers/task-schedule-occurrence-index";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { createTaskContextSchema, taskSchema } from "@/schemas/task.schema";
import { taskScheduleInputSchema } from "@/schemas/task-schedule.schema";
import {
  createScheduledTaskInTransaction,
  findScheduledTaskCreateOperation,
  requireScheduledTaskCreator,
} from "@/services/task-schedule-create.service";
import { taskInclude } from "@/types/task";

const scheduledTaskSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("workspace") }),
  z.object({
    type: z.literal("project"),
    projectId: z.string().uuid(),
  }),
]);

export const createScheduledTaskRequestSchema = z
  .object({
    operationId: z.string().uuid(),
    source: scheduledTaskSourceSchema,
    name: z.string().trim().min(1).max(LIMITS.NAME_MAX_LENGTH).optional(),
    description: z.string().nullish(),
    assigneeId: z.string().min(1),
    context: createTaskContextSchema.optional(),
    schedule: taskScheduleInputSchema,
  })
  .openapi("CreateScheduledTaskRequest");

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/scheduled",
    description:
      "Atomically create a queued Task with a mutable version 2 schedule and Calendar occurrence index.",
    tags: ["Tasks"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: createScheduledTaskRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(taskSchema, "Scheduled task created"),
      400: jsonErrorResponse("Bad Request"),
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
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const userContext = requireUserContext(c.var.authContext);
    const user = await prisma.user.findUnique({
      where: { id: userContext.userId },
      select: { email: true, emailVerified: true },
    });
    if (!user?.emailVerified || !isNmkrEmail(user.email)) {
      throw forbidden("Calendar is only available to NMKR users");
    }
    const body = c.req.valid("json");
    const preflightCreator = await requireScheduledTaskCreator(
      c.var.authContext,
      workspaceContext.workspaceId,
    );
    await requireAssignedOrganizationSeat(
      preflightCreator.userContext.userId,
      workspaceContext.organizationId,
    );
    const scheduledTaskInput = {
      creator: preflightCreator,
      workspaceId: workspaceContext.workspaceId,
      organizationId: workspaceContext.organizationId,
      ...body,
      name: body.name ?? "",
      requestFingerprintPayload: {
        name: body.name ?? null,
        description: body.description ?? null,
        context: body.context ?? null,
      },
    };
    let taskId = await findScheduledTaskCreateOperation(
      scheduledTaskInput,
      prisma,
    );
    if (!taskId) {
      const resolvedName = await resolveTaskName({
        name: body.name,
        description: body.description,
      });
      const projectId =
        body.source.type === "project" ? body.source.projectId : null;
      const project = await findTaskProjectInWorkspace(
        projectId,
        workspaceContext.workspaceId,
      );
      if (body.context?.briefing !== false) {
        await healProjectBriefingUrl(project, workspaceContext.workspaceId);
      }
      taskId = await serializableTransaction(async (tx) => {
        const creator = await requireScheduledTaskCreator(
          c.var.authContext,
          workspaceContext.workspaceId,
          tx,
        );
        await requireAssignedOrganizationSeat(
          creator.userContext.userId,
          workspaceContext.organizationId,
          tx,
        );
        const project = await findTaskProjectInWorkspace(
          projectId,
          workspaceContext.workspaceId,
          tx,
        );
        const description = await resolveTaskDescriptionWithContext({
          context: body.context,
          description: body.description,
          organizationId: workspaceContext.organizationId,
          ownerId: creator.userContext.userId,
          project,
          tx,
        });
        return await createScheduledTaskInTransaction(
          {
            ...scheduledTaskInput,
            creator,
            name: resolvedName,
            description,
          },
          tx,
        );
      }, "Scheduled task creation conflicted; retry with the same operationId").catch(
        (error: unknown) => {
          if (error instanceof TaskScheduleOccurrenceLimitError) {
            throw badRequest(error.message);
          }
          throw error;
        },
      );
    }
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: taskInclude,
    });

    return created(c, taskSchema.parse(mapTask(task)));
  });
}
