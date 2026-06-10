import { createRoute, z } from "@hono/zod-openapi";
import { jobInclude, Prisma } from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import { workspaceRepository } from "@sokosumi/database/repositories";

import { requireJobCollaboration } from "@/helpers/access-control";
import { conflict, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
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
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { organizationId: targetOrganizationId } = c.req.valid("json");

    const job = await prisma.$transaction(
      async (tx) => {
        // A delegated coworker may only move a job whose task is assigned to it.
        await requireJobCollaboration(c.var.authContext, id, tx);

        const currentJob = await tx.job.findFirst({
          where: {
            id,
            userId: userContext.userId,
          },
          select: {
            taskId: true,
            workspace: {
              select: {
                organizationId: true,
              },
            },
          },
        });

        if (!currentJob) {
          throw forbidden("You can only access your own jobs");
        }

        if (currentJob.taskId !== null) {
          throw conflict("Task-attached jobs inherit their task workspace");
        }

        const workspaceChanged =
          targetOrganizationId !== currentJob.workspace.organizationId;

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
            userId: userContext.userId,
            tx,
          });
        }

        const workspace = await workspaceRepository.upsertWorkspaceForContext(
          userContext.userId,
          targetOrganizationId ?? null,
          tx,
        );

        await tx.job.update({
          where: {
            id,
          },
          data: {
            workspaceId: workspace.id,
            projectId: null,
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
