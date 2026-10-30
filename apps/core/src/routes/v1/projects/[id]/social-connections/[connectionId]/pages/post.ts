import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  addProjectSocialConnectionPageRequestSchema,
  projectSocialConnectionParamsSchema,
  projectSocialConnectionSchema,
} from "@/schemas/project-social-connection.schema";
import { addProjectSocialConnectionPage } from "@/services/project-social-connection-pages.service";

import { mapProjectSocialConnectionServiceError } from "../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/social-connections/{connectionId}/pages",
    description:
      "Add a LinkedIn company page the connected personal account administers as its own Project account. LinkedIn re-confirms the role first; adding a page twice returns the existing account. 404 while company pages are disabled. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: projectSocialConnectionParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: addProjectSocialConnectionPageRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        projectSocialConnectionSchema,
        "Project account for the page",
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
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, connectionId } = c.req.valid("param");
    const { externalAccountId } = c.req.valid("json");

    try {
      const connection = await addProjectSocialConnectionPage({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        socialConnectionId: connectionId,
        externalAccountId,
      });
      return created(c, projectSocialConnectionSchema.parse(connection));
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
