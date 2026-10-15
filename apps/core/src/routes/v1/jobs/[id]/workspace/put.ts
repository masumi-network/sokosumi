import { createRoute, z } from "@hono/zod-openapi";
import { jobInclude } from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import { requireJobCollaboration } from "@/helpers/access-control";
import { badRequest, conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { resolveWorkspaceForContextOrNotFound } from "@/helpers/personal-workspace-error";
import { ok } from "@/helpers/response";
import { resolveResponsibleUserId } from "@/helpers/task-visibility";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
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

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/workspace",
    description:
      "Change job workspace. Only the person responsible for the job may move it. A job nobody is responsible for needs an organization owner or admin and cannot move to a personal workspace.",
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

    const job = await serializableTransaction(async (tx) => {
      // Moving belongs to the job's responsible person (ADR 0056). A
      // delegated coworker may only move a job whose task is assigned to it.
      const accessibleJob = await requireJobCollaboration(
        c.var.authContext,
        id,
        tx,
        { right: "manage" },
      );

      const currentJob = await tx.job.findFirst({
        where: { id },
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
        throw notFound("Job not found");
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

      // `null` targets the authenticated user's personal workspace, where a
      // job nobody is responsible for would have nobody left to manage it.
      if (
        targetOrganizationId === null &&
        resolveResponsibleUserId(accessibleJob) === null
      ) {
        throw badRequest(
          "Work nobody is responsible for cannot move to a personal workspace",
        );
      }
      if (targetOrganizationId !== null) {
        await resolveMemberOrganizationById({
          id: targetOrganizationId,
          userId: userContext.userId,
          tx,
        });
      }

      const workspace = await resolveWorkspaceForContextOrNotFound(
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
    }, "Job changed by a concurrent request. Please retry.");

    return ok(c, jobSchema.parse(job));
  });
}
