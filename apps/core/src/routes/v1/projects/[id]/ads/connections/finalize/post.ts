import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { finalizeProjectAdConnectionResponseSchema } from "@/schemas/project-ad-account.schema";
import {
  finalizeProjectSocialConnectionRequestSchema,
  projectSocialConnectionProjectParamsSchema,
} from "@/schemas/project-social-connection.schema";
import { finalizeProjectAdConnection } from "@/services/project-ad-accounts.service";

import { mapAdsServiceError } from "../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/ads/connections/finalize",
    description:
      "Finish a redeemed ad connection and list the ad accounts it can reach. Safe to retry. Requires an interactive user session in the Project's Workspace.",
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
        finalizeProjectAdConnectionResponseSchema,
        "Project ad connection and its available ad accounts",
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
    const { connectionId } = c.req.valid("json");

    try {
      const result = await finalizeProjectAdConnection({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        userId: userContext.userId,
        connectionId,
      });
      return ok(c, finalizeProjectAdConnectionResponseSchema.parse(result));
    } catch (error) {
      return mapAdsServiceError(error);
    }
  });
}
