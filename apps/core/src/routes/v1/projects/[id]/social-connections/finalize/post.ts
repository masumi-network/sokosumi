import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created, ok } from "@/helpers/response";
import { SocialAccountChoiceRequiredError } from "@/helpers/social-account-choice";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireFirstPartyUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  finalizeProjectSocialConnectionRequestSchema,
  projectSocialConnectionProjectParamsSchema,
  projectSocialConnectionSchema,
  socialAccountChoicesSchema,
} from "@/schemas/project-social-connection.schema";
import { finalizeProjectSocialConnection } from "@/services/project-social-connections.service";
import { scheduleSocialAccountRefresh } from "@/services/social-account-sync";

import { mapProjectSocialConnectionServiceError } from "../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/social-connections/finalize",
    description:
      "Finalize a redeemed social connection for a Project. With `offerChoice`, a sign-in that reaches several accounts (a person's LinkedIn Pages and profile, a login's Facebook Pages) answers 200 with them and keeps nothing; finalize again with the picked choice's `accountChoiceId`. Requires an interactive user session in the Project's Workspace.",
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
      200: jsonSuccessResponse(
        socialAccountChoicesSchema,
        "The sign-in reaches several accounts: pick one",
      ),
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
    const userContext = requireFirstPartyUserAuthContext(c.var.authContext);

    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const input = c.req.valid("json");

    try {
      const connection = await finalizeProjectSocialConnection({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        ...input,
      });
      await scheduleSocialAccountRefresh({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        connectionId: connection.id,
        trigger: "connect",
      }).catch(() => undefined);
      return created(c, projectSocialConnectionSchema.parse(connection));
    } catch (error) {
      if (error instanceof SocialAccountChoiceRequiredError) {
        return ok(c, socialAccountChoicesSchema.parse(error));
      }
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
