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
import { listAdMarketAdsResponseSchema } from "@/schemas/project-ad-market.schema";
import { projectSocialConnectionProjectParamsSchema } from "@/schemas/project-social-connection.schema";
import { listProjectAdMarketAds } from "@/services/project-ad-market.service";

import { mapAdsServiceError } from "../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/ads/market/ads",
    description:
      "Recent Google ads, with preview images, of the biggest advertisers for the Project's market profile keywords: at most 40 ads of the last 30 days, last shown first. Cached for 24h per profile. 404 until a market profile is saved. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: { params: projectSocialConnectionProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(listAdMarketAdsResponseSchema, "Market ads"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
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

    try {
      const result = await listProjectAdMarketAds({
        projectId,
        workspaceId: workspaceContext.workspaceId,
      });
      return ok(c, listAdMarketAdsResponseSchema.parse(result));
    } catch (error) {
      return mapAdsServiceError(error);
    }
  });
}
