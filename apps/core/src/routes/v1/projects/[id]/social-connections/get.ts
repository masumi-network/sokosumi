import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  projectSocialConnectionProjectParamsSchema,
  projectSocialConnectionSchema,
} from "@/schemas/project-social-connection.schema";
import { listProjectSocialConnections } from "@/services/project-social-connections.service";

import { mapProjectSocialConnectionServiceError } from "./route-helpers.js";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-connections",
    description:
      "List a Project's current X social connections. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: { params: projectSocialConnectionProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        z.array(projectSocialConnectionSchema),
        "Project social connections",
      ),
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
    const { id: projectId } = c.req.valid("param");

    try {
      const connections = await listProjectSocialConnections({
        projectId,
        workspaceId: workspaceContext.workspaceId,
      });
      return ok(c, z.array(projectSocialConnectionSchema).parse(connections));
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
