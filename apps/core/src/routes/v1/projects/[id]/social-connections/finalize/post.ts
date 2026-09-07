import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  finalizeProjectSocialConnectionRequestSchema,
  projectSocialConnectionProjectParamsSchema,
  projectSocialConnectionSchema,
} from "@/schemas/project-social-connection.schema";
import { finalizeProjectSocialConnection } from "@/services/project-social-connections.service";

import { mapProjectSocialConnectionServiceError } from "../route-helpers.js";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/social-connections/finalize",
    description:
      "Finalize a redeemed X social connection for a Project. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: projectSocialConnectionProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: finalizeProjectSocialConnectionRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        projectSocialConnectionSchema,
        "Project social connection finalized",
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
    const { id: projectId } = c.req.valid("param");
    const { connectionId } = c.req.valid("json");

    try {
      const connection = await finalizeProjectSocialConnection({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        connectionId,
      });
      return created(c, projectSocialConnectionSchema.parse(connection));
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
