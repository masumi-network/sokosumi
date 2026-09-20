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
  projectNameCountQuery,
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
    q: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .openapi({
        param: { name: "q", in: "query" },
        description:
          "Case-insensitive substring match on the project name, applied across the whole workspace before pagination",
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

    const search = queryParams.q;
    const workspaceId = workspaceContext.workspaceId;
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
        workspaceId,
        cursor,
        take: takePlusOne,
        visibility: activityVisibility,
        search,
      }),
    );
    const page = ranked.slice(0, take);
    // Prisma `contains` compiles to unescaped ILIKE, so `%` / `_` in `q`
    // would inflate the total relative to the escaped ranked query.
    // A Pin belongs to a person (ADR 0036), so only a user context resolves
    // one. A coworker or vendor reading the same list sees every row unpinned
    // rather than seeing the bound user's Pins as its own.
    const readerUserId =
      c.var.authContext.actor === "user" ? c.var.authContext.userId : null;
    const [rows, count, stars] = await Promise.all([
      prisma.project.findMany({
        where: { workspaceId, id: { in: page.map((row) => row.id) } },
        include: projectListCountsInclude,
      }),
      search
        ? prisma
            .$queryRaw<Array<{ count: bigint }>>(
              projectNameCountQuery(workspaceId, search),
            )
            .then((result) => Number(result[0]?.count ?? 0n))
        : prisma.project.count({ where: { workspaceId } }),
      // Bounded by the page, and served by the (userId, projectId) unique
      // index, so this never grows with how much the reader has Pinned.
      readerUserId
        ? prisma.projectStar.findMany({
            where: {
              userId: readerUserId,
              projectId: { in: page.map((row) => row.id) },
            },
            select: { projectId: true, starredAt: true },
          })
        : Promise.resolve([]),
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const starredAtByProjectId = new Map(
      stars.map((star) => [star.projectId, star.starredAt]),
    );
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
          starredAt: starredAtByProjectId.get(id) ?? null,
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
