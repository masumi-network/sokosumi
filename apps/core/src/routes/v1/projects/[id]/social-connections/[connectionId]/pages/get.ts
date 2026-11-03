import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  projectSocialConnectionPagesSchema,
  projectSocialConnectionParamsSchema,
} from "@/schemas/project-social-connection.schema";
import { listProjectSocialConnectionPages } from "@/services/project-social-connection-pages.service";

import { mapProjectSocialConnectionServiceError } from "../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/social-connections/{connectionId}/pages",
    description:
      "List the LinkedIn company pages a connected personal LinkedIn account administers, marking pages already added to the Project. `permission_missing` means the authorization lacks the page scopes. 404 while company pages are disabled. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: { params: projectSocialConnectionParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        projectSocialConnectionPagesSchema,
        "Pages the account can post as",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, connectionId } = c.req.valid("param");

    try {
      const pages = await listProjectSocialConnectionPages({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        socialConnectionId: connectionId,
      });
      return ok(c, projectSocialConnectionPagesSchema.parse(pages));
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
