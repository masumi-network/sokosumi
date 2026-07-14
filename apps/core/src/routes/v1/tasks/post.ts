import { createRoute, z } from "@hono/zod-openapi";
import {
  TaskEventOrigin,
  VendorGrantStatus,
  VendorPermission,
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
  getVendorGrant,
  isGrantDeniedOrRevoked,
  notifyWorkspaceApproversOfPendingGrant,
  requestCreateGrant,
  throwGrantAccessError,
  VendorPermissionApi,
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

async function createTaskRecord(
  params: {
    userId: string;
    organizationId: string | null;
    workspaceId: string;
    body: z.infer<typeof createTaskRequestSchema>;
    resolvedName: string;
    pendingVendorGrantId?: string | null;
    /** When parking, coerce to READY so workspace readers see the task. */
    forceReady?: boolean;
  },
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
) {
  const {
    body,
    forceReady,
    organizationId,
    pendingVendorGrantId,
    resolvedName,
    userId,
    workspaceId,
  } = params;

  if (body.projectId !== null && body.projectId !== undefined) {
    const project = await tx.project.findFirst({
      where: {
        id: body.projectId,
        workspaceId,
      },
      select: { id: true },
    });

    if (!project) {
      throw notFound("Project not found");
    }
  }

  const status = forceReady ? TaskStatus.READY : body.status;

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
      metadata: null,
      nextRunAt: null,
      pendingVendorGrantId: pendingVendorGrantId ?? null,
      events: {
        create: {
          status,
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

    const existingGrant = await getVendorGrant({
      vendorId: authContext.vendorId,
      workspaceId: workspaceContext.workspaceId,
      permission: VendorPermission.task_create,
    });

    if (existingGrant && isGrantDeniedOrRevoked(existingGrant.status)) {
      throwGrantAccessError(
        existingGrant.status,
        VendorPermissionApi.TASK_CREATE,
      );
    }

    if (existingGrant?.status === VendorGrantStatus.GRANTED) {
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

    // Resolve grant status inside the transaction so a concurrent approve/deny
    // cannot leave a READY task permanently parked.
    const { task, createdPendingGrant } = await prisma.$transaction(
      async (tx) => {
        const { grant, created: pendingCreated } = await requestCreateGrant(
          {
            vendorId: authContext.vendorId,
            workspaceId: workspaceContext.workspaceId,
            requestedByUserId: userContext.userId,
            notify: false,
          },
          tx,
        );

        if (isGrantDeniedOrRevoked(grant.status)) {
          throwGrantAccessError(grant.status, VendorPermissionApi.TASK_CREATE);
        }

        if (grant.status === VendorGrantStatus.GRANTED) {
          const grantedTask = await createTaskRecord(
            {
              userId: userContext.userId,
              organizationId: userContext.organizationId,
              workspaceId: workspaceContext.workspaceId,
              body,
              resolvedName,
            },
            tx,
          );
          return { task: grantedTask, createdPendingGrant: null };
        }

        const parkedTask = await createTaskRecord(
          {
            userId: userContext.userId,
            organizationId: userContext.organizationId,
            workspaceId: workspaceContext.workspaceId,
            body,
            resolvedName,
            pendingVendorGrantId: grant.id,
            forceReady: true,
          },
          tx,
        );

        return {
          task: parkedTask,
          createdPendingGrant: pendingCreated
            ? {
                vendorId: authContext.vendorId,
                workspaceId: workspaceContext.workspaceId,
                grantId: grant.id,
              }
            : null,
        };
      },
    );

    if (createdPendingGrant) {
      await notifyWorkspaceApproversOfPendingGrant({
        vendorId: createdPendingGrant.vendorId,
        workspaceId: createdPendingGrant.workspaceId,
        primaryGrantId: createdPendingGrant.grantId,
        permissions: [VendorPermissionApi.TASK_CREATE],
        bundled: false,
      });
    }

    return created(c, taskSchema.parse(mapTask(task)));
  });
}
