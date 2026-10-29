import { createRoute, z } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { loadAgentPreviewsByIds } from "@/helpers/history";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import {
  type ProjectRecentActivityRow,
  projectRecentActivityQuery,
} from "@/helpers/project-activity";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { projectActivityItemSchema } from "@/schemas/project.schema";
import { resolveProjectReaderAccess } from "@/types/project";

const query = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .openapi({
      param: { name: "limit", in: "query" },
      description: "How many rows to return, newest first",
      example: 5,
    }),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/activity",
    description:
      "The newest task, job and project events across the workspace's open projects, one row per task, job or project, newest first. Only events the reader can see; the same sources that set a project's lastActivityAt.",
    tags: ["Projects"],
    request: { query },
    responses: {
      200: jsonSuccessResponse(
        z.array(projectActivityItemSchema),
        "Recent activity across open projects",
      ),
      400: jsonErrorResponse("Bad Request"),
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
    const { limit } = c.req.valid("query");
    const { sqlWhere: visibility } = await resolveProjectReaderAccess(
      c.var.authContext,
      workspaceContext.workspaceId,
    );
    const rows = await prisma.$queryRaw<ProjectRecentActivityRow[]>(
      projectRecentActivityQuery({
        workspaceId: workspaceContext.workspaceId,
        take: limit,
        visibility,
      }),
    );
    const projectIds = [...new Set(rows.map((row) => row.projectId))];
    const agentIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.kind === "job" && row.agentId ? [row.agentId] : [],
        ),
      ),
    ];
    const [projects, agentPreviewById] = await Promise.all([
      prisma.project.findMany({
        where: {
          workspaceId: workspaceContext.workspaceId,
          id: { in: projectIds },
        },
        select: { id: true, name: true, identifier: true, logo: true },
      }),
      loadAgentPreviewsByIds(agentIds, prisma),
    ]);
    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );

    // `unknown[]`: the rows carry raw strings, and the parse below validates them.
    const items = rows.flatMap((row): unknown[] => {
      const project = projectById.get(row.projectId);
      if (!project) return [];
      const base = { id: row.id, createdAt: row.at, project };

      if (row.kind === "task") {
        return [
          {
            ...base,
            kind: row.kind,
            taskId: row.entityId,
            title: row.title ?? "",
            status: row.status,
          },
        ];
      }
      if (row.kind === "job") {
        const agentId = row.agentId ?? "";
        return [
          {
            ...base,
            kind: row.kind,
            jobId: row.entityId,
            agentId,
            title: row.title ?? agentPreviewById.get(agentId)?.name ?? null,
            status: row.status,
          },
        ];
      }
      return [{ ...base, kind: row.kind, event: row.status }];
    });

    return ok(c, z.array(projectActivityItemSchema).parse(items));
  });
}
