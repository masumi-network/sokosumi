import { createRoute, z } from "@hono/zod-openapi";
import { sharedTable } from "@sokosumi/database/sql-tables";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  buildHumanJobParentVisibilityWhere,
  buildHumanTaskVisibilitySql,
} from "@/helpers/task-visibility";
import { networkUsesSharedSchema } from "@/lib/db/network-scope";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { mapProjectForApi, projectSchema } from "@/schemas/project.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    }),
  jobId: z.string().openapi({
    param: { name: "jobId", in: "path" },
    example: "job_abc",
  }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/{id}/jobs/{jobId}",
    description:
      "Remove a job from a project without deleting the job. A person by any sign-in (browser, API key or OAuth token); Coworker and Soko Bot keys are rejected.",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
    },
    responses: {
      200: jsonSuccessResponse(projectSchema, "Project"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("CMO project is read-only"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, jobId } = c.req.valid("param");

    const workspaceId = workspaceContext.workspaceId;
    const { networkScope } = c.var;
    const { networkDb, sharedDb } = networkScope;

    const project = await sharedDb.project.findFirst({
      where: { id: projectId, workspaceId },
    });
    if (!project) {
      throw notFound("Project or job link not found");
    }

    const updatedCount = networkUsesSharedSchema()
      ? (
          await networkDb.job.updateMany({
            where: {
              id: jobId,
              projectId,
              workspaceId,
              ...buildHumanJobParentVisibilityWhere(userContext.userId),
            },
            data: { projectId: null },
          })
        ).count
      : await networkDb.$executeRaw`
          UPDATE ${networkScope.networkTable("Job")} AS j
          SET "projectId" = NULL, "updatedAt" = ${new Date()}
          WHERE j."id" = ${jobId}
            AND j."projectId" = ${projectId}::uuid
            AND j."workspaceId" = ${workspaceId}::uuid
            AND (
              j."taskId" IS NULL
              OR EXISTS (
                SELECT 1
                FROM ${sharedTable("task")} AS t
                WHERE t."id" = j."taskId"
                ${buildHumanTaskVisibilitySql(userContext.userId)}
              )
            )
        `;
    if (updatedCount === 0) {
      throw notFound("Project or job link not found");
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
