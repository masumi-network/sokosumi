import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import {
  CoworkerGrantScope,
  NotificationKind,
  TaskEventOrigin,
} from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import {
  requireCoworkerCapability,
  requireTaskAssignableCoworker,
} from "@/helpers/access-control";
import {
  hasCoworkerGrant,
  requestCoworkerGrant,
} from "@/helpers/coworker-grants";
import { notFound } from "@/helpers/error";
import { createNotification } from "@/helpers/notifications";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { mapTask, validateTaskCoworkerAssignment } from "@/helpers/task";
import { resolveTaskName } from "@/helpers/task-name";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { isCoworkerAuthContext, requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { taskSchema } from "@/schemas/task.schema";
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
    coworkerId: z.string().nullish().openapi({ example: "cow_123" }),
    status: z
      .enum([TaskStatus.DRAFT, TaskStatus.READY])
      .optional()
      .default(TaskStatus.DRAFT)
      .openapi({ example: TaskStatus.READY }),
    origin: z
      .enum(TaskEventOrigin)
      .optional()
      .default(TaskEventOrigin.SOKOSUMI)
      .openapi({
        example: TaskEventOrigin.SLACK,
        description:
          "Origin of the initial task event. Defaults to SOKOSUMI if not provided.",
      }),
  })
  .superRefine((data, ctx) => {
    const hasCoworkerId =
      data.coworkerId !== null && data.coworkerId !== undefined;

    if (data.status !== TaskStatus.DRAFT && !hasCoworkerId) {
      ctx.addIssue({
        code: "custom",
        message: "coworkerId is required when creating a non-draft task",
        path: ["coworkerId"],
      });
    }
  });

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description: "Create task",
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
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireUserContext(authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const body = c.req.valid("json");

    // A delegated coworker needs the user's TASK_CREATE grant for the task
    // to start immediately. Without it the creation still succeeds but is
    // parked in INPUT_REQUIRED with `awaitingAcceptance` ("needs your
    // acceptance" — the attention column). Agents cannot see or act on
    // awaiting tasks (all agent gates filter `awaitingAcceptance`), so the
    // status is safe despite being non-DRAFT. A pending grant request is
    // recorded and the user notified; accepting flips the task to READY.
    const delegatedCoworkerId =
      isCoworkerAuthContext(authContext) && authContext.delegation
        ? authContext.coworkerId
        : null;
    if (delegatedCoworkerId) {
      // Same caller gate as every other delegated task surface: the CALLING
      // coworker must be usable (whitelisted, tasks capability) — otherwise
      // any minted API key could park tasks and mint consent requests.
      await requireCoworkerCapability(delegatedCoworkerId, "tasks");
    }
    let effectiveStatus: TaskStatus = body.status;
    let awaitingAcceptance = false;
    if (delegatedCoworkerId && body.status !== TaskStatus.DRAFT) {
      const granted = await hasCoworkerGrant(
        delegatedCoworkerId,
        userContext.userId,
        CoworkerGrantScope.TASK_CREATE,
      );
      if (!granted) {
        awaitingAcceptance = true;
        effectiveStatus = TaskStatus.INPUT_REQUIRED;
        await requestCoworkerGrant(
          delegatedCoworkerId,
          userContext.userId,
          CoworkerGrantScope.TASK_CREATE,
        );
      }
    }

    const resolvedName = await resolveTaskName({
      name: body.name,
      description: body.description,
    });

    const task = await prisma.$transaction(async (tx) => {
      validateTaskCoworkerAssignment({
        status: effectiveStatus,
        coworkerId: body.coworkerId,
      });

      if (body.coworkerId !== null && body.coworkerId !== undefined) {
        await requireTaskAssignableCoworker(body.coworkerId, tx);
      }

      if (body.projectId !== null && body.projectId !== undefined) {
        const project = await tx.project.findFirst({
          where: {
            id: body.projectId,
            workspaceId: workspaceContext.workspaceId,
          },
          select: { id: true },
        });

        if (!project) {
          throw notFound("Project not found");
        }
      }

      return tx.task.create({
        data: {
          userId: userContext.userId,
          organizationId: userContext.organizationId,
          workspaceId: workspaceContext.workspaceId,
          projectId: body.projectId ?? null,
          name: resolvedName,
          description: body.description ?? null,
          coworkerId: body.coworkerId ?? null,
          createdByCoworkerId: delegatedCoworkerId,
          awaitingAcceptance,
          status: effectiveStatus,
          metadata: null,
          nextRunAt: null,
          events: {
            create: {
              status: effectiveStatus,
              comment: null,
              origin: body.origin,
              userId: userContext.userId,
              // Attribute delegated creations to the acting coworker so the
              // activity trail shows "created by Hermes on behalf of you".
              coworkerId: delegatedCoworkerId,
            },
          },
        },
        include: taskInclude,
      });
    });

    if (awaitingAcceptance) {
      try {
        const creator = await prisma.coworker.findUnique({
          where: { id: delegatedCoworkerId ?? "" },
          select: { name: true, slug: true, image: true },
        });
        // coworkerImage/coworkerSlug are not referenced by the message —
        // they let notification UIs show the creating coworker's avatar.
        await createNotification({
          userId: userContext.userId,
          kind: NotificationKind.TASK,
          referenceId: task.id,
          eventId: task.id,
          messageKey: "Notifications.Task.awaitingAcceptance",
          messageParams: {
            coworkerName: creator?.name ?? "A coworker",
            taskName: task.name ?? "Untitled task",
            ...(creator?.image ? { coworkerImage: creator.image } : {}),
            ...(creator?.slug ? { coworkerSlug: creator.slug } : {}),
          },
          metadata: { workspaceId: task.workspaceId },
        });
      } catch (error) {
        Sentry.captureException(error, {
          extra: { taskId: task.id, notificationType: "task-notification" },
        });
      }
    }

    return created(c, taskSchema.parse(mapTask(task)));
  });
}
