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
import {
  adCampaignDetailsSchema,
  adRangeQuerySchema,
  projectAdCampaignParamsSchema,
} from "@/schemas/project-ad-account.schema";
import { getProjectAdCampaignDetails } from "@/services/project-ad-accounts.service";

import { mapAdsServiceError } from "../../../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/ads/accounts/{accountId}/campaigns/{campaignId}",
    description:
      "Details of one Google campaign of an ad account attached to a Project: settings, targeting, keywords, ad, sitelinks, callouts, and spend, impressions, clicks, CTR, CPC and conversions over the range (totals and one entry per day). Money is a decimal in the account currency. Google Ads accounts only; a Meta account, an unknown campaign and a removed campaign are 404. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: projectAdCampaignParamsSchema,
      query: adRangeQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(adCampaignDetailsSchema, "Campaign details"),
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
    const { id: projectId, accountId, campaignId } = c.req.valid("param");
    const { range } = c.req.valid("query");

    try {
      const details = await getProjectAdCampaignDetails({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        accountId,
        campaignId,
        range,
      });
      return ok(c, adCampaignDetailsSchema.parse(details));
    } catch (error) {
      return mapAdsServiceError(error);
    }
  });
}
