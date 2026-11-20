import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { SocialAccountChoiceRequiredError } from "@/helpers/social-account-choice";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireFirstPartyUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { mapProjectSocialConnectionServiceError } from "@/routes/v1/projects/[id]/social-connections/route-helpers";
import {
  cmoProjectParamsSchema,
  cmoSocialConnectionFinalizedSchema,
} from "@/schemas/cmo.schema";
import { finalizeProjectSocialConnectionRequestSchema } from "@/schemas/project-social-connection.schema";
import { requireCuso } from "@/services/cmo-cuso.service";
import { finalizeProjectSocialConnection } from "@/services/project-social-connections.service";
import { scheduleSocialAccountRefresh } from "@/services/social-account-sync";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/social-connections/finalize",
  operationId: "finalizeCmoSocialConnectionForProject",
  tags: ["CMO"],
  description:
    "Finalizes a redeemed social connection for the Cuso's Project, as `POST /v1/projects/{id}/social-connections/finalize` does. When the sign-in reaches several accounts (a person's LinkedIn Pages, a login's Facebook Pages) it answers `choose` with them and keeps nothing; finalize again with the picked choice's `accountChoiceId`. An interactive session or a first-party app's token.",
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
      cmoSocialConnectionFinalizedSchema,
      "Project social connection finalized, or the accounts to pick from",
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
    const { projectId, workspaceId } = await requireCuso({
      userId,
      projectId: c.req.valid("param").projectId,
    }).catch(rethrow);

    try {
      const connection = await finalizeProjectSocialConnection({
        projectId,
        workspaceId,
        userId,
        ...input,
        offerChoice: true,
      });
      await scheduleSocialAccountRefresh({
        projectId,
        workspaceId,
        connectionId: connection.id,
        trigger: "connect",
      }).catch(() => undefined);
      return created(c, { state: "connected" as const, choices: [] });
    } catch (error) {
      if (error instanceof SocialAccountChoiceRequiredError) {
        return created(c, {
          state: "choose" as const,
          choices: error.choices,
        });
      }
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
