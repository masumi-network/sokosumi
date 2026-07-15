import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import {
  GrantResumeStatus,
  type Prisma,
  TaskEventOrigin,
  VendorGrantStatus,
} from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { requireTaskAssignableCoworker } from "@/helpers/access-control";
import { errorResponseSchema, notFound } from "@/helpers/error";
import {
  jsonContent,
  jsonErrorResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { mapTask, validateTaskCoworkerAssignment } from "@/helpers/task";
import { resolveTaskName } from "@/helpers/task-name";
import {
  isGrantDeniedOrRevoked,
  lockAndGetVendorGrantById,
  notifyWorkspaceApproversOfPendingGrant,
  parseGrantResumeStatus,
  requestWorkspaceGrantCommitted,
  throwGrantAccessError,
} from "@/helpers/vendor-grants";
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
      403: {
        description:
          "Forbidden. Delegated coworker create may return kind `grant_denied` / `grant_revoked` when vendor create access was denied.",
        content: jsonContent(errorResponseSchema),
      },
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

async function assertTaskProjectInWorkspace(
  projectId: string | null | undefined,
  workspaceId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  if (projectId === null || projectId === undefined) {
    return;
  }

  const project = await tx.project.findFirst({
    where: {
      id: projectId,
      workspaceId,
    },
    select: { id: true },
  });

  if (!project) {
    throw notFound("Project not found");
  }
}

async function createTaskRecord(
  params: {
    userId: string;
    organizationId: string | null;
    workspaceId: string;
    body: z.infer<typeof createTaskRequestSchema>;
    resolvedName: string;
    pendingVendorGrantId?: string | null;
    grantResumeStatus?: GrantResumeStatus | null;
  },
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
) {
  const {
    body,
    organizationId,
    grantResumeStatus,
    pendingVendorGrantId,
    resolvedName,
    userId,
    workspaceId,
  } = params;

  await assertTaskProjectInWorkspace(body.projectId, workspaceId, tx);

  const isGrantPending = pendingVendorGrantId != null;
  const status = isGrantPending ? TaskStatus.GRANT_PENDING : body.status;
  const initialEventStatus = status;

  return tx.task.create({
    data: {
      userId,
      organizationId,
      workspaceId,
      projectId: body.projectId ?? null,
      name: resolvedName,
      description: body.description ?? null,
      coworkerId: body.coworkerId ?? null,
      status,
      grantResumeStatus: isGrantPending ? grantResumeStatus : null,
      metadata: null,
      nextRunAt: null,
      pendingVendorGrantId: pendingVendorGrantId ?? null,
      events: {
        create: {
          status: initialEventStatus,
          comment: null,
          origin: body.origin,
          userId,
          coworkerId: null,
        },
      },
    },
    include: taskInclude,
  });
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = c.var.authContext;
    const userContext = requireUserContext(authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const body = c.req.valid("json");

    const resolvedName = await resolveTaskName({
      name: body.name,
      description: body.description,
    });

    validateTaskCoworkerAssignment({
      status: body.status,
      coworkerId: body.coworkerId,
    });

    if (body.coworkerId !== null && body.coworkerId !== undefined) {
      await requireTaskAssignableCoworker(body.coworkerId);
    }

    const shouldEnforceCreateGrant =
      isCoworkerAuthContext(authContext) && Boolean(authContext.context);

    if (!shouldEnforceCreateGrant) {
      const task = await prisma.$transaction(async (tx) =>
        createTaskRecord(
          {
            userId: userContext.userId,
            organizationId: userContext.organizationId,
            workspaceId: workspaceContext.workspaceId,
            body,
            resolvedName,
          },
          tx,
        ),
      );

      return created(c, taskSchema.parse(mapTask(task)));
    }

    await assertTaskProjectInWorkspace(
      body.projectId,
      workspaceContext.workspaceId,
    );

    const { grant } = await requestWorkspaceGrantCommitted({
      vendorId: authContext.vendorId,
      workspaceId: workspaceContext.workspaceId,
      requestedByUserId: userContext.userId,
      notify: false,
    });

    if (isGrantDeniedOrRevoked(grant.status)) {
      throwGrantAccessError(grant.status);
    }

    const task = await prisma.$transaction(async (tx) => {
      const lockedGrant = await lockAndGetVendorGrantById(grant.id, tx);

      if (isGrantDeniedOrRevoked(lockedGrant.status)) {
        throwGrantAccessError(lockedGrant.status);
      }

      if (lockedGrant.status === VendorGrantStatus.GRANTED) {
        return createTaskRecord(
          {
            userId: userContext.userId,
            organizationId: userContext.organizationId,
            workspaceId: workspaceContext.workspaceId,
            body,
            resolvedName,
          },
          tx,
        );
      }

      return createTaskRecord(
        {
          userId: userContext.userId,
          organizationId: userContext.organizationId,
          workspaceId: workspaceContext.workspaceId,
          body,
          resolvedName,
          pendingVendorGrantId: lockedGrant.id,
          grantResumeStatus: parseGrantResumeStatus(body.status),
        },
        tx,
      );
    });

    if (task.status === TaskStatus.GRANT_PENDING) {
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
