import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  projectAdCampaignParamsSchema,
  updateAdCampaignDetailsRequestSchema,
} from "@/schemas/project-ad-account.schema";
import { updateProjectAdCampaignDetails } from "@/services/project-ad-accounts.service";

import { mapAdsServiceError } from "../../../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: "/{id}/ads/accounts/{accountId}/campaigns/{campaignId}",
    description:
      "Edit a Google campaign: its name, daily budget (decimal in the account currency) and the whole google spec (the same fields as a create; Display images may also be `{assetId, role}` to keep an image of the ad). Only what differs from the campaign is changed, in one atomic call; nothing differs, nothing is sent (still 204). Only a campaign that is editable (`campaign.editable` in the details) can be edited here (409), `google.type` must be the campaign's type (422), the start date cannot change once the campaign started (422), and a kept image must be one of the ad's images (422). A shared budget cannot change its amount (409). A Google validation or policy failure is returned as 422 with Google's message. Google Ads accounts only; a Meta account, an unknown campaign and a removed campaign are 404. New Display images must belong to the active Workspace's Drive. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: projectAdCampaignParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: updateAdCampaignDetailsRequestSchema },
        },
      },
    },
    responses: {
      204: { description: "Campaign edited, or nothing to change" },
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
    const { name, dailyBudget, google } = c.req.valid("json");

    try {
      await updateProjectAdCampaignDetails({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        accountId,
        campaignId,
        userId: userContext.userId,
        organizationId: workspaceContext.organizationId,
        name,
        dailyBudget,
        google,
      });
      return empty(c);
    } catch (error) {
      return mapAdsServiceError(error);
    }
  });
}
