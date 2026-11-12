import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireFirstPartyUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { mapProjectSocialConnectionServiceError } from "@/routes/v1/projects/[id]/social-connections/route-helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import {
  finalizeProjectSocialConnectionRequestSchema,
  projectSocialConnectionSchema,
} from "@/schemas/project-social-connection.schema";
import { requireCuso } from "@/services/cmo-cuso.service";
import { finalizeProjectSocialConnection } from "@/services/project-social-connections.service";
import { scheduleSocialAccountRefresh } from "@/services/social-account-sync";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/social-connections/finalize",
  operationId: "finalizeCmoSocialConnectionForProject",
  tags: ["CMO"],
  description:
    "Finalizes a redeemed X social connection for the Cuso's Project, as `POST /v1/projects/{id}/social-connections/finalize` does. An interactive session or a first-party app's token.",
  request: {
    params: cmoProjectParamsSchema,
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
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireFirstPartyUserAuthContext(c.var.authContext);
    const { connectionId } = c.req.valid("json");
    const { projectId, workspaceId } = await requireCuso({
      userId,
      projectId: c.req.valid("param").projectId,
    }).catch(rethrow);

    try {
      const connection = await finalizeProjectSocialConnection({
        projectId,
        workspaceId,
        userId,
        connectionId,
      });
      await scheduleSocialAccountRefresh({
        projectId,
        workspaceId,
        connectionId: connection.id,
        trigger: "connect",
      }).catch(() => undefined);
      return created(c, projectSocialConnectionSchema.parse(connection));
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
