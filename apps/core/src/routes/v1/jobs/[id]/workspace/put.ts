import { createRoute, z } from "@hono/zod-openapi";
import { jobInclude, Prisma } from "@sokosumi/database";
import {
  mapJobWithStatus,
  resolveWorkspaceForContext,
} from "@sokosumi/database/helpers";

import { requireOwnedJobAccess } from "@/helpers/access-control";
import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { jobSchema } from "@/schemas/job.schema";
import { serializeJobDetails } from "@/types/job";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "job_123",
  }),
});

export const putJobWorkspaceRequestSchema = z.object({
  organizationId: z.string().min(1).nullable().openapi({ example: "org_123" }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/workspace",
    description: "Change job workspace",
    tags: ["Jobs"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: putJobWorkspaceRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(jobSchema, "Change job workspace"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { organizationId: targetOrganizationId } = c.req.valid("json");

    const job = await prisma.$transaction(
      async (tx) => {
        const ownedJob = await requireOwnedJobAccess(authContext, id, tx);

        if (ownedJob.taskId !== null) {
          throw conflict("Task-attached jobs inherit their task workspace");
        }

        if (ownedJob.jobScheduleId !== null) {
          throw conflict("Scheduled jobs inherit their schedule workspace");
        }

        const currentWorkspace = await tx.workspace.findUnique({
          where: { id: ownedJob.workspaceId },
          select: { organizationId: true },
        });

        if (!currentWorkspace) {
          throw notFound("Job workspace not found");
        }

        const workspaceChanged =
          targetOrganizationId !== currentWorkspace.organizationId;

        if (!workspaceChanged) {
          const existingJob = await tx.job.findUnique({
            where: { id },
            include: jobInclude,
          });

          if (!existingJob) {
            throw notFound("Job not found");
          }

          return serializeJobDetails(mapJobWithStatus(existingJob));
        }

        // `null` targets the authenticated user's personal workspace.
        if (targetOrganizationId !== null) {
          await resolveMemberOrganizationById({
            id: targetOrganizationId,
            userId: authContext.userId,
            tx,
          });
        }

        const workspace = await resolveWorkspaceForContext(
          authContext.userId,
          targetOrganizationId,
          tx,
        );

        await tx.job.update({
          where: {
            id,
          },
          data: {
            workspaceId: workspace.id,
          },
        });

        const updatedJob = await tx.job.findUnique({
          where: { id },
          include: jobInclude,
        });

        if (!updatedJob) {
          throw notFound("Job not found");
        }

        return serializeJobDetails(mapJobWithStatus(updatedJob));
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return ok(c, jobSchema.parse(job));
  });
}
