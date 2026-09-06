import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { TaskStatus } from "@sokosumi/database";

import { LIMITS } from "@/config/constants";
import { errorResponseSchema } from "@/helpers/error";
import {
  jsonContent,
  jsonErrorResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { created } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import {
  refineAssigneeXorConflict,
  resolveAssigneeIdFromRequest,
} from "@/helpers/task-assignee-alias";
import {
  findTaskProjectInWorkspace,
  healProjectBriefingUrl,
  resolveTaskDescriptionWithContext,
} from "@/helpers/task-create-context";
import {
  refineChannelOriginConflict,
  resolveTaskEventChannel,
} from "@/helpers/task-event-channel";
import { resolveTaskName } from "@/helpers/task-name";
import { notifyWorkspaceApproversOfPendingGrant } from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  isSokoBotAuthContext,
  requireUserContext,
} from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  createTaskContextSchema,
  taskEventChannelField,
  taskEventDeprecatedOriginField,
  taskSchema,
} from "@/schemas/task.schema";
import {
  createTaskForActor,
  type TaskDomainActor,
} from "@/services/task-domain.service";
import { taskInclude } from "@/types/task";

export const createTaskRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(LIMITS.NAME_MAX_LENGTH)
      .optional()
      .openapi({ example: "Review onboarding" }),
    description: z.string().nullish().openapi({ example: "Notes go here" }),
    projectId: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .openapi({ example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa" }),
    assigneeId: z.string().nullish().openapi({ example: "cow_123" }),
    /** @deprecated Use `assigneeId`. */
    coworkerId: z.string().nullish().openapi({
      example: "cow_123",
      deprecated: true,
      description: "Deprecated. Use assigneeId instead.",
    }),
    assigneeSokoBotId: z.string().uuid().nullish().openapi({
      example: "01960001-0001-7001-8001-000000000099",
    }),
    status: z
      .enum([TaskStatus.DRAFT, TaskStatus.READY])
      .optional()
      .default(TaskStatus.DRAFT)
      .openapi({ example: TaskStatus.READY }),
    channel: taskEventChannelField.optional(),
    origin: taskEventDeprecatedOriginField.optional(),
    context: createTaskContextSchema.optional().openapi({
      description:
        "Task context attachments. DESIGN.md, project briefing, and project memory are attached by default; explicit false values opt out.",
    }),
  })
  .superRefine((data, ctx) => {
    refineChannelOriginConflict(data, ctx);
    refineAssigneeXorConflict(data, ctx);

    const assigneeId = resolveAssigneeIdFromRequest(data);
    const hasCoworker = assigneeId != null && assigneeId !== "";
    const hasSokoBot =
      data.assigneeSokoBotId != null && data.assigneeSokoBotId !== "";

    if (data.status !== TaskStatus.DRAFT && !hasCoworker && !hasSokoBot) {
      ctx.addIssue({
        code: "custom",
        message:
          "assigneeId or assigneeSokoBotId is required when creating a non-draft task",
        path: ["assigneeId"],
      });
    }
  })
  .transform((data) => {
    const { coworkerId: _coworkerId, ...rest } = data;
    return {
      ...rest,
      assigneeId: resolveAssigneeIdFromRequest(data),
      assigneeSokoBotId: data.assigneeSokoBotId ?? null,
      channel: resolveTaskEventChannel(data),
    };
  });

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description:
      "Create a task. By default Core prepends available DESIGN.md, project briefing, and project memory links. Use context flags only to opt out or select a workspace/custom brand.",
    tags: ["Tasks"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: createTaskRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(taskSchema, "Create task"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: {
        description:
          "Forbidden. Delegated coworker create may return kind `grant_denied` / `grant_revoked` when vendor create access was denied.",
        content: jsonContent(errorResponseSchema),
      },
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

function resolveTaskDomainActor(
  authContext: AuthenticationContext,
  ownerId: string,
): TaskDomainActor {
  if (isCoworkerAuthContext(authContext)) {
    return {
      kind: "coworker",
      coworkerId: authContext.coworkerId,
      vendorId: authContext.vendorId,
      enforceWorkspaceGrant: Boolean(authContext.context),
    };
  }

  if (isSokoBotAuthContext(authContext)) {
    return {
      kind: "soko_bot",
      sokoBotId: authContext.sokoBotId,
    };
  }

  return { kind: "user", userId: ownerId };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = c.var.authContext;
    const userContext = requireUserContext(authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const body = c.req.valid("json");

    await requireAssignedOrganizationSeat(
      userContext.userId,
      workspaceContext.organizationId,
    );

    const resolvedName = await resolveTaskName({
      name: body.name,
      description: body.description,
    });

    const shouldEnforceCreateGrant =
      isCoworkerAuthContext(authContext) && Boolean(authContext.context);
    const project = await findTaskProjectInWorkspace(
      body.projectId,
      workspaceContext.workspaceId,
    );
    const projectWithBriefing =
      !shouldEnforceCreateGrant && body.context?.briefing !== false
        ? await healProjectBriefingUrl(project, workspaceContext.workspaceId)
        : project;

    const task = await prisma.$transaction(async (tx) => {
      const createdTask = await createTaskForActor(
        {
          actor: resolveTaskDomainActor(authContext, userContext.userId),
          ownerId: userContext.userId,
          organizationId: userContext.organizationId,
          workspaceId: workspaceContext.workspaceId,
          projectId: body.projectId,
          name: resolvedName,
          description: body.description,
          resolveDescription: async (tx) => {
            const contextProject =
              shouldEnforceCreateGrant && body.context?.briefing !== false
                ? await healProjectBriefingUrl(
                    project,
                    workspaceContext.workspaceId,
                  )
                : projectWithBriefing;
            return resolveTaskDescriptionWithContext({
              context: body.context,
              description: body.description,
              organizationId: userContext.organizationId,
              ownerId: userContext.userId,
              project: contextProject,
              tx,
            });
          },
          assigneeId: body.assigneeId,
          assigneeSokoBotId: body.assigneeSokoBotId,
          status: body.status,
          channel: body.channel,
        },
        tx,
      );
      return tx.task.findUniqueOrThrow({
        where: { id: createdTask.id },
        include: taskInclude,
      });
    });

    if (
      isCoworkerAuthContext(authContext) &&
      task.status === TaskStatus.GRANT_PENDING &&
      task.pendingVendorGrantId
    ) {
      try {
        await notifyWorkspaceApproversOfPendingGrant({
          vendorId: authContext.vendorId,
          workspaceId: workspaceContext.workspaceId,
          grantId: task.pendingVendorGrantId,
        });
      } catch (error) {
        console.error(
          "Failed to notify approvers of pending vendor grant after task create",
          error,
        );
        Sentry.captureException(error, {
          extra: {
            grantId: task.pendingVendorGrantId,
            vendorId: authContext.vendorId,
            workspaceId: workspaceContext.workspaceId,
            errorType: "vendor-grant-notify-after-create",
          },
        });
      }
    }

    return created(c, taskSchema.parse(mapTask(task)));
  });
}
