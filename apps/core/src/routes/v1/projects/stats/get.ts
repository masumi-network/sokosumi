import { createRoute, z } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { getProjectStatsByProjectIds } from "@/helpers/project-stats";
import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "@/helpers/query-params";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { projectStatsBatchSchema } from "@/schemas/project.schema";

const projectIdsQuerySchema = z
  .preprocess(
    preprocessMultiValueQueryInput,
    z
      .array(z.string().uuid())
      .min(1)
      .optional()
      .transform(deduplicateQueryValues),
  )
  .openapi({
    param: { name: "projectIds", in: "query" },
    description:
      "Optional comma-separated project IDs. Omit to return stats for all workspace projects.",
    example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  });

const query = z.object({
  projectIds: projectIdsQuerySchema,
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/stats",
    description: "Get per-project task and job status counts",
    tags: ["Projects"],
    request: {
      query,
    },
    responses: {
      200: jsonSuccessResponse(projectStatsBatchSchema, "Project stats"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    await requireAuthorizedUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { projectIds } = c.req.valid("query");

    const projects = await prisma.project.findMany({
      where: {
        workspaceId: workspaceContext.workspaceId,
        ...(projectIds ? { id: { in: projectIds } } : {}),
      },
      select: { id: true },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    const workspaceProjectIds = projects.map((project) => project.id);
    const projectStats = await getProjectStatsByProjectIds(
      workspaceContext.workspaceId,
      workspaceProjectIds,
    );

    return ok(
      c,
      projectStatsBatchSchema.parse({
        projects: projectStats,
      }),
    );
  });
}
