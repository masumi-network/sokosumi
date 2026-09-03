import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  projectSocialConnectionParamsSchema,
  projectSocialConnectionSchema,
} from "@/schemas/project-social-connection.schema";
import { disconnectProjectSocialConnection } from "@/services/project-social-connections.service";

import { mapProjectSocialConnectionServiceError } from "../route-helpers.js";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/social-connections/{connectionId}",
    description:
      "Disconnect an X social account from a Project. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: { params: projectSocialConnectionParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        projectSocialConnectionSchema,
        "Project social connection disconnected",
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
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, connectionId: socialConnectionId } =
      c.req.valid("param");

    try {
      const { connection } = await disconnectProjectSocialConnection({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        socialConnectionId,
      });
      return ok(c, projectSocialConnectionSchema.parse(connection));
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
