import { createRoute } from "@hono/zod-openapi";
import { isFirstPartyAppUrl } from "@/config/cors-allow-origin";
import { unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireFirstPartyUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { mapProjectSocialConnectionServiceError } from "@/routes/v1/projects/[id]/social-connections/route-helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import {
  initiateProjectSocialConnectionRequestSchema,
  initiateProjectSocialConnectionResponseSchema,
} from "@/schemas/project-social-connection.schema";
import { requireCuso } from "@/services/cmo-cuso.service";
import { initiateProjectSocialConnection } from "@/services/project-social-connections.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/social-connections/initiate",
  operationId: "initiateCmoSocialConnectionForProject",
  tags: ["CMO"],
  description:
    "Begins connecting a social account to the Cuso's Project, as `POST /v1/projects/{id}/social-connections/initiate` does. An interactive session or a first-party app's token.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: initiateProjectSocialConnectionRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      initiateProjectSocialConnectionResponseSchema,
      "Project social connection initiated",
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
    const input = c.req.valid("json");
    if (input.callbackUrl && !isFirstPartyAppUrl(input.callbackUrl)) {
      throw unprocessableEntity("Unknown return address");
    }
    const { projectId, workspaceId } = await requireCuso({
      userId,
      projectId: c.req.valid("param").projectId,
    }).catch(rethrow);

    try {
      const connection = await initiateProjectSocialConnection({
        projectId,
        workspaceId,
        userId,
        ...input,
      });
      return created(
        c,
        initiateProjectSocialConnectionResponseSchema.parse(connection),
      );
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
