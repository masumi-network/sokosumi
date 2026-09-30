import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { initiateProjectAdConnectionRequestSchema } from "@/schemas/project-ad-account.schema";
import {
  initiateProjectSocialConnectionResponseSchema,
  projectSocialConnectionProjectParamsSchema,
} from "@/schemas/project-social-connection.schema";
import { initiateProjectAdConnection } from "@/services/project-ad-accounts.service";

import { mapProjectAdServiceError } from "../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/ads/connections/initiate",
    description:
      "Begin connecting a Google Ads or Meta Ads account to a Project. Complete the returned link in the OAuth popup, then finalize. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: projectSocialConnectionProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: initiateProjectAdConnectionRequestSchema,
          },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        initiateProjectSocialConnectionResponseSchema,
        "Project ad connection initiated",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
      502: jsonErrorResponse("Bad Gateway"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    // Ads share the social beta gate.
    await requireSocialBetaAccess(userContext.userId, prisma);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const { provider } = c.req.valid("json");

    try {
      const connection = await initiateProjectAdConnection({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        provider,
      });
      return created(
        c,
        initiateProjectSocialConnectionResponseSchema.parse(connection),
      );
    } catch (error) {
      return mapProjectAdServiceError(error);
    }
  });
}
