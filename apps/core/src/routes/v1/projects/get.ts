import { createRoute, z } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import {
  encodeProjectActivityCursor,
  type ProjectActivityRow,
  projectActivityPageQuery,
  projectActivityVisibility,
} from "@/helpers/project-activity";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import {
  mapProjectForApi,
  projectListItemSchema,
} from "@/schemas/project.schema";
import {
  createProjectListCountsInclude,
  resolveProjectReaderVisibility,
} from "@/types/project";

const query = cursorPaginationQuerySchema
  .extend({
    cursor: z
      .string()
      .max(1024)
      .optional()
      .openapi({
        param: { name: "cursor", in: "query" },
        description:
          "Opaque activity cursor returned in nextCursor by the previous page",
      }),
  })
  .openapi("ProjectPaginationQuery");

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description:
      "List workspace projects by latest visible task/job event, ready task output or project lifecycle activity (creation fallback; ID descending breaks ties), paginated globally",
    tags: ["Projects"],
    request: {
      query,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(projectListItemSchema),
        "Projects in the workspace",
      ),
      400: jsonErrorResponse("Invalid pagination cursor"),
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
    const queryParams = c.req.valid("query");
    const { cursor, take } = parseCursorPagination(queryParams);

    const where = { workspaceId: workspaceContext.workspaceId };
    const takePlusOne = take + 1;
    const visibility = await resolveProjectReaderVisibility(
      c.var.authContext,
      workspaceContext.workspaceId,
    );
    const projectListCountsInclude = createProjectListCountsInclude(
      workspaceContext.workspaceId,
      visibility,
    );

    const activityVisibility = await projectActivityVisibility(
      c.var.authContext,
      workspaceContext.workspaceId,
    );
    const ranked = await prisma.$queryRaw<ProjectActivityRow[]>(
      projectActivityPageQuery({
        workspaceId: workspaceContext.workspaceId,
        cursor,
        take: takePlusOne,
        visibility: activityVisibility,
      }),
    );
    const page = ranked.slice(0, take);
    const [rows, count] = await Promise.all([
      prisma.project.findMany({
        where: { ...where, id: { in: page.map((row) => row.id) } },
        include: projectListCountsInclude,
      }),
      prisma.project.count({ where }),
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const projectsWithCounts = page.flatMap(({ id, lastActivityAt }) => {
      const row = byId.get(id);
      if (!row) return [];

      const { _count, ...project } = row;
      return [
        {
          ...mapProjectForApi(project),
          taskCount: _count.tasks,
          jobCount: _count.jobs,
          lastActivityAt,
        },
      ];
    });
    const paginationMeta = createPaginationMeta(
      page,
      count,
      take,
      ranked.length > take,
      cursor,
      (row) => encodeProjectActivityCursor(workspaceContext.workspaceId, row),
    );

    return ok(
      c,
      z.array(projectListItemSchema).parse(projectsWithCounts),
      paginationMeta,
    );
  });
}
