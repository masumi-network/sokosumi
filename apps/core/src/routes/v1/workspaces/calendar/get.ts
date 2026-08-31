import { createRoute, z } from "@hono/zod-openapi";

import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  workspaceCalendarItemSchema,
  workspaceCalendarQuerySchema,
} from "@/schemas/workspace-calendar.schema";

import {
  parseWorkspaceCalendarQuery,
  readWorkspaceCalendar,
} from "../[id]/calendar/get.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/calendar",
    description:
      "List scheduled Task projections and persisted schedule occurrences for the active workspace",
    tags: ["Workspaces"],
    request: {
      query: workspaceCalendarQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(workspaceCalendarItemSchema),
        "Active workspace Calendar items",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = await requireAuthorizedUserContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const query = c.req.valid("query");
    const calendarQuery = parseWorkspaceCalendarQuery(query);
    const { items, pagination } = await readWorkspaceCalendar(
      workspaceContext.workspaceId,
      userContext.userId,
      calendarQuery,
      c.var.authContext,
    );

    return ok(c, items, pagination);
  });
}
