import { createRoute, z } from "@hono/zod-openapi";
import { isNmkrEmail } from "@sokosumi/utils";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { forbidden, notFound } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  getCalendarTaskWhere,
  parseWorkspaceCalendarQuery,
  readWorkspaceCalendar,
} from "@/routes/v1/workspaces/[id]/calendar/get";
import {
  workspaceCalendarItemSchema,
  workspaceCalendarQuerySchema,
} from "@/schemas/workspace-calendar.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "22222222-2222-7222-8222-222222222222",
    }),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/calendar",
    description:
      "List indexed planned and released schedule occurrences for a Project",
    tags: ["Projects"],
    request: {
      params: paramsSchema,
      query: workspaceCalendarQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(workspaceCalendarItemSchema),
        "Project Calendar items",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
    const user = await prisma.user.findUnique({
      where: { id: userContext.userId },
      select: { email: true },
    });
    if (!isNmkrEmail(user?.email)) {
      throw forbidden("Calendar is only available to NMKR users");
    }

    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const project = await prisma.project.findFirst({
      where: { id: projectId, workspaceId: workspace.workspaceId },
      select: { id: true },
    });
    if (!project) {
      throw notFound("Project not found");
    }

    const taskWhere = await getCalendarTaskWhere(
      authContext,
      workspace.workspaceId,
    );

    const { items, pagination } = await readWorkspaceCalendar(
      workspace.workspaceId,
      userContext.userId,
      parseWorkspaceCalendarQuery(c.req.valid("query")),
      { projectId: project.id, taskWhere },
    );

    return ok(c, items, pagination);
  });
}
