import { createRoute, z } from "@hono/zod-openapi";

import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { projectSchema } from "@/schemas/project.schema";

const query = cursorPaginationQuerySchema;

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: "List projects in the active workspace (paginated)",
    tags: ["Projects"],
    request: {
      query,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(projectSchema),
        "Projects in the workspace",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    const where = { workspaceId: workspaceContext.workspaceId };
    const takePlusOne = take + 1;

    const [projects, count] = await prisma.$transaction([
      prisma.project.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      }),
      prisma.project.count({ where }),
    ]);

    const hasMore = projects.length === takePlusOne;
    const pagedProjects = projects.slice(0, take);
    const paginationMeta = createPaginationMeta(
      pagedProjects,
      count,
      take,
      hasMore,
      cursor,
    );

    return ok(c, z.array(projectSchema).parse(pagedProjects), paginationMeta);
  });
}
