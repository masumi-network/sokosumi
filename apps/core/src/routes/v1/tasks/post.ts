import { createRoute, z } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import {
  GrantResumeStatus,
  type Prisma,
  TaskStatus,
  VendorGrantStatus,
} from "@sokosumi/database";

import { LIMITS } from "@/config/constants";
import {
  requireTaskAssignableCoworker,
  requireWhitelistedCoworkerForColdStart,
} from "@/helpers/access-control";
import { errorResponseSchema, notFound } from "@/helpers/error";
import {
  jsonContent,
  jsonErrorResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import { requireOrchestratorIdForAttribution } from "@/helpers/orchestrator-instance";
import { created } from "@/helpers/response";
import { mapTask, validateTaskAssigneeAssignment } from "@/helpers/task";
import {
  refineAssigneeIdAliasConflict,
  resolveAssigneeIdFromRequest,
} from "@/helpers/task-assignee-alias";
import {
  refineChannelOriginConflict,
  resolveTaskEventChannel,
} from "@/helpers/task-event-channel";
import { resolveTaskName } from "@/helpers/task-name";
import {
  isGrantDeniedOrRevoked,
  notifyWorkspaceApproversOfPendingGrant,
  parseGrantResumeStatus,
  requestWorkspaceGrant,
  throwGrantAccessError,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  isOrchestratorAuthContext,
  requireUserContext,
} from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  taskEventChannelField,
  taskEventDeprecatedOriginField,
  taskSchema,
} from "@/schemas/task.schema";
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
    status: z
      .enum([TaskStatus.DRAFT, TaskStatus.READY])
      .optional()
      .default(TaskStatus.DRAFT)
      .openapi({ example: TaskStatus.READY }),
    channel: taskEventChannelField.optional(),
    origin: taskEventDeprecatedOriginField.optional(),
  })
  .superRefine((data, ctx) => {
    refineChannelOriginConflict(data, ctx);
    refineAssigneeIdAliasConflict(data, ctx);

    const assigneeId = resolveAssigneeIdFromRequest(data);
    const hasAssigneeId = assigneeId !== null && assigneeId !== undefined;

    if (data.status !== TaskStatus.DRAFT && !hasAssigneeId) {
      ctx.addIssue({
        code: "custom",
        message: "assigneeId is required when creating a non-draft task",
        path: ["assigneeId"],
      });
    }
  })
  .transform((data) => {
    const { coworkerId: _coworkerId, ...rest } = data;
    return {
      ...rest,
      assigneeId: resolveAssigneeIdFromRequest(data),
      channel: resolveTaskEventChannel(data),
    };
  });

const route = withCoworkerContextHeaderParameters(
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

async function resolveTaskCreatorFields(
  authContext: AuthenticationContext,
  ownerId: string,
) {
  if (isOrchestratorAuthContext(authContext)) {
    return {
      creatorOrchestratorId:
        await requireOrchestratorIdForAttribution(authContext),
      creatorUserId: null,
      creatorCoworkerId: null,
    };
  }

  if (isCoworkerAuthContext(authContext)) {
    return {
      creatorCoworkerId: authContext.coworkerId,
      creatorUserId: null,
      creatorOrchestratorId: null,
    };
  }

  return {
    creatorUserId: ownerId,
    creatorCoworkerId: null,
    creatorOrchestratorId: null,
  };
}

async function resolveInitialTaskEventActor(
  authContext: AuthenticationContext,
  ownerId: string,
) {
  if (isOrchestratorAuthContext(authContext)) {
    return {
      userId: null,
      coworkerId: null,
      orchestratorId: await requireOrchestratorIdForAttribution(authContext),
    };
  }

  if (isCoworkerAuthContext(authContext)) {
    return {
      userId: null,
      coworkerId: authContext.coworkerId,
      orchestratorId: null,
    };
  }

  return {
    userId: ownerId,
    coworkerId: null,
    orchestratorId: null,
  };
}

async function createTaskRecord(
  params: {
    ownerId: string;
    organizationId: string | null;
    workspaceId: string;
    body: z.infer<typeof createTaskRequestSchema>;
    resolvedName: string;
    authContext: AuthenticationContext;
    pendingVendorGrantId?: string | null;
    grantResumeStatus?: GrantResumeStatus | null;
  },
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
) {
  const {
    authContext,
    body,
    grantResumeStatus,
    organizationId,
    ownerId,
    pendingVendorGrantId,
    resolvedName,
    workspaceId,
  } = params;

  await assertTaskProjectInWorkspace(body.projectId, workspaceId, tx);

  const isGrantPending = pendingVendorGrantId != null;
  const status = isGrantPending ? TaskStatus.GRANT_PENDING : body.status;
  const initialEventStatus = status;
  const creatorFields = await resolveTaskCreatorFields(authContext, ownerId);
  const initialEventActor = await resolveInitialTaskEventActor(
    authContext,
    ownerId,
  );

  return tx.task.create({
    data: {
      ownerId,
      organizationId,
      workspaceId,
      projectId: body.projectId ?? null,
      name: resolvedName,
      description: body.description ?? null,
      assigneeId: body.assigneeId ?? null,
      ...creatorFields,
      status,
      grantResumeStatus: isGrantPending ? grantResumeStatus : null,
      metadata: null,
      nextRunAt: null,
      pendingVendorGrantId: pendingVendorGrantId ?? null,
      events: {
        create: {
          status: initialEventStatus,
          comment: null,
          channel: body.channel,
          ...initialEventActor,
        },
      },
    },
    include: taskInclude,
  });
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = c.var.authContext;
    // The ONLY route that accepts an unapproved delegation. A vendor with no
    // relationship to this user can reach exactly this path, and the grant gate
    // below parks whatever it creates as GRANT_PENDING until a human approves —
    // that is the documented cold start. Every other user-scoped route rejects
    // an unapproved context inside requireUserContext.
    const userContext = requireUserContext(authContext, {
      allowUnapprovedDelegation: true,
    });

    // Bootstrap tier: no relationship with this user yet. The create below
    // still writes a row and notifies approvers with caller-supplied text, so
    // restrict first contact to platform-approved coworkers rather than any
    // vendor key. Approved delegations skip this entirely.
    const isBootstrapDelegation =
      isCoworkerAuthContext(authContext) &&
      Boolean(authContext.context) &&
      authContext.isDelegationApproved !== true;

    if (isBootstrapDelegation) {
      await requireWhitelistedCoworkerForColdStart(authContext.coworkerId);
    }
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const body = c.req.valid("json");

    const resolvedName = await resolveTaskName({
      name: body.name,
      description: body.description,
    });

    validateTaskAssigneeAssignment({
      status: body.status,
      assigneeId: body.assigneeId,
    });

    if (body.assigneeId !== null && body.assigneeId !== undefined) {
      await requireTaskAssignableCoworker(body.assigneeId);
    }

    const shouldEnforceCreateGrant =
      isCoworkerAuthContext(authContext) && Boolean(authContext.context);

    if (!shouldEnforceCreateGrant) {
      const task = await prisma.$transaction(async (tx) =>
        createTaskRecord(
          {
            ownerId: userContext.userId,
            organizationId: userContext.organizationId,
            workspaceId: workspaceContext.workspaceId,
            body,
            resolvedName,
            authContext,
          },
          tx,
        ),
      );

      return created(c, taskSchema.parse(mapTask(task)));
    }

    const task = await prisma.$transaction(async (tx) => {
      await assertTaskProjectInWorkspace(
        body.projectId,
        workspaceContext.workspaceId,
        tx,
      );

      const { grant } = await requestWorkspaceGrant(
        {
          vendorId: authContext.vendorId,
          workspaceId: workspaceContext.workspaceId,
          requestedByUserId: userContext.userId,
          notify: false,
        },
        tx,
      );

      if (isGrantDeniedOrRevoked(grant.status)) {
        throwGrantAccessError(grant.status);
      }

      // An unapproved delegation must never produce an unparked task. Today
      // that is already implied — a GRANTED grant on this workspace is one of
      // the things that marks the delegation approved — but the two checks are
      // separate queries, so assert it here rather than trusting they stay in
      // agreement. Parking is the fail-safe direction.
      const isDelegationApproved =
        !isCoworkerAuthContext(authContext) ||
        authContext.isDelegationApproved === true;

      if (grant.status === VendorGrantStatus.GRANTED && isDelegationApproved) {
        return createTaskRecord(
          {
            ownerId: userContext.userId,
            organizationId: userContext.organizationId,
            workspaceId: workspaceContext.workspaceId,
            body,
            resolvedName,
            authContext,
          },
          tx,
        );
      }

      return createTaskRecord(
        {
          ownerId: userContext.userId,
          organizationId: userContext.organizationId,
          workspaceId: workspaceContext.workspaceId,
          body,
          resolvedName,
          authContext,
          pendingVendorGrantId: grant.id,
          grantResumeStatus: parseGrantResumeStatus(body.status),
        },
        tx,
      );
    });

    if (task.status === TaskStatus.GRANT_PENDING && task.pendingVendorGrantId) {
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
