import { createRoute, z } from "@hono/zod-openapi";
import { sharedTable } from "@sokosumi/database/sql-tables";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  buildHumanJobParentVisibilitySql,
  buildHumanJobParentVisibilityWhere,
} from "@/helpers/task-visibility";
import { networkUsesSharedSchema } from "@/lib/db/network-scope";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  addProjectJobRequestSchema,
  mapProjectForApi,
  projectSchema,
} from "@/schemas/project.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/jobs",
    description:
      "Add an existing job to a project. A person by any sign-in (browser, API key or OAuth token); Coworker and Soko Bot keys are rejected.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
      body: {
        content: {
          "application/json": {
            schema: addProjectJobRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(projectSchema, "Project"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const body = c.req.valid("json");

    const workspaceId = workspaceContext.workspaceId;
    const { networkScope } = c.var;
    const { networkDb, sharedDb } = networkScope;

    const project = await sharedDb.project.findFirst({
      where: { id: projectId, workspaceId },
    });
    if (!project) {
      throw notFound("Project not found");
    }

    const job = networkUsesSharedSchema()
      ? await networkDb.job.findFirst({
          where: {
            id: body.jobId,
            workspaceId,
            ...buildHumanJobParentVisibilityWhere(userContext.userId),
          },
          select: { projectId: true },
        })
      : (
          await networkDb.$queryRaw<{ projectId: string | null }[]>`
            SELECT j."projectId"
            FROM ${networkScope.networkTable("Job")} j
            LEFT JOIN ${sharedTable("task")} t ON t.id = j."taskId"
            WHERE j.id = ${body.jobId}
              AND j."workspaceId" = ${workspaceId}::uuid
            ${buildHumanJobParentVisibilitySql(userContext.userId)}
            LIMIT 1
          `
        )[0];
    if (!job) {
      throw notFound("Job not found");
    }

    if (job.projectId !== null && job.projectId !== projectId) {
      throw conflict("Job is already assigned to a project");
    }

    if (job.projectId !== projectId) {
      await networkDb.job.update({
        where: { id: body.jobId },
        data: {
          projectId,
          workspaceId,
        },
      });
    }

    return ok(
      c,
      mapProjectForApi(project, {
        // cmoProjectLock refused this write on a CMO Project.
        cmo: false,
      }),
    );
  });
}
