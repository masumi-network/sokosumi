import { createRoute, z } from "@hono/zod-openapi";
import { TaskEventOrigin, VendorGrantStatus } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { requireTaskAssignableCoworker } from "@/helpers/access-control";
import { errorResponseSchema, forbidden, notFound } from "@/helpers/error";
import {
  jsonContent,
  jsonErrorResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { mapTask, validateTaskCoworkerAssignment } from "@/helpers/task";
import { resolveTaskName } from "@/helpers/task-name";
import {
  hasAutonomyGrant,
  isGrantDenied,
  isVendorGrantEnabled,
  resolveRequiredGrantScope,
} from "@/helpers/vendor-grants";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
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
          "Forbidden. Delegated coworker create may return kind `grant_denied` when vendor access was denied or revoked.",
        content: jsonContent(errorResponseSchema),
      },
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse(
        "Conflict — vendor grant upsert concurrency while parking task",
      ),
    },
  }),
);

async function resolveAssigneeVendorId(coworkerId: string | null | undefined) {
  if (!coworkerId) {
    return null;
  }

  const coworker = await prisma.coworker.findUnique({
    where: { id: coworkerId },
    select: { vendorId: true },
  });

  return coworker?.vendorId ?? null;
}

async function createTaskRecord(
  params: {
    userId: string;
    organizationId: string | null;
    workspaceId: string;
    body: z.infer<typeof createTaskRequestSchema>;
    resolvedName: string;
    pendingVendorGrantId?: string | null;
  },
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
) {
  const {
    body,
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

  return tx.task.create({
    data: {
      userId,
      organizationId,
      workspaceId,
      projectId: body.projectId ?? null,
      name: resolvedName,
      description: body.description ?? null,
      coworkerId: body.coworkerId ?? null,
      status: body.status,
      metadata: null,
      nextRunAt: null,
      pendingVendorGrantId: pendingVendorGrantId ?? null,
      events: {
        create: {
          status: body.status,
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

    const shouldEnforceGrant =
      isVendorGrantEnabled() &&
      isCoworkerAuthContext(authContext) &&
      authContext.delegation;

    if (!shouldEnforceGrant) {
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

    const assigneeVendorId = await resolveAssigneeVendorId(body.coworkerId);
    const scope = resolveRequiredGrantScope(
      authContext.vendorId,
      assigneeVendorId,
    );

    const existingGrant = await prisma.vendorGrant.findUnique({
      where: {
        vendorId_userId_workspaceId_scope: {
          vendorId: authContext.vendorId,
          userId: userContext.userId,
          workspaceId: workspaceContext.workspaceId,
          scope,
        },
      },
      select: { id: true, status: true },
    });

    if (existingGrant && isGrantDenied(existingGrant.status)) {
      throw forbidden("Vendor access was denied for this workspace", {
        kind: "grant_denied",
      });
    }

    const granted =
      existingGrant?.status === VendorGrantStatus.GRANTED ||
      (await hasAutonomyGrant({
        vendorId: authContext.vendorId,
        userId: userContext.userId,
        workspaceId: workspaceContext.workspaceId,
        scope,
      }));

    if (granted) {
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

    const task = await serializableTransaction(async (tx) => {
      const grant = await tx.vendorGrant.upsert({
        where: {
          vendorId_userId_workspaceId_scope: {
            vendorId: authContext.vendorId,
            userId: userContext.userId,
            workspaceId: workspaceContext.workspaceId,
            scope,
          },
        },
        create: {
          vendorId: authContext.vendorId,
          userId: userContext.userId,
          workspaceId: workspaceContext.workspaceId,
          scope,
          status: VendorGrantStatus.PENDING,
        },
        update: {},
        select: { id: true, status: true },
      });

      if (isGrantDenied(grant.status)) {
        throw forbidden("Vendor access was denied for this workspace", {
          kind: "grant_denied",
        });
      }

      return createTaskRecord(
        {
          userId: userContext.userId,
          organizationId: userContext.organizationId,
          workspaceId: workspaceContext.workspaceId,
          body,
          resolvedName,
          pendingVendorGrantId: grant.id,
        },
        tx,
      );
    }, "Could not park task while resolving vendor access");

    return created(c, taskSchema.parse(mapTask(task)));
  });
}
