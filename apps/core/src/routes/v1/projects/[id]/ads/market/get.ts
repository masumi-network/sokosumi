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
import { getAdMarketProfileResponseSchema } from "@/schemas/project-ad-market.schema";
import { projectSocialConnectionProjectParamsSchema } from "@/schemas/project-social-connection.schema";
import { getProjectAdMarketProfile } from "@/services/project-ad-market.service";

import { mapAdsServiceError } from "../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/ads/market",
    description:
      "Get a Project's ads market profile (keywords, country, language); `profile` is null until one is saved. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: { params: projectSocialConnectionProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        getAdMarketProfileResponseSchema,
        "Project ads market profile",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
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

    try {
      const profile = await getProjectAdMarketProfile({
        projectId,
        workspaceId: workspaceContext.workspaceId,
      });
      return ok(c, getAdMarketProfileResponseSchema.parse({ profile }));
    } catch (error) {
      return mapAdsServiceError(error);
    }
  });
}
