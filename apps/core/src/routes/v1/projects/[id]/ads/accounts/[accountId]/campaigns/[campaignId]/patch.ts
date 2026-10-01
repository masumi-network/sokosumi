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
  updateAdCampaignRequestSchema,
} from "@/schemas/project-ad-account.schema";
import { updateProjectAdCampaign } from "@/services/project-ad-accounts.service";

import { mapAdsServiceError } from "../../../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "patch",
    path: "/{id}/ads/accounts/{accountId}/campaigns/{campaignId}",
    description:
      "Pause or resume a campaign and/or change its daily budget (decimal in the account currency). The campaign must belong to the attached ad account. A Google campaign on a shared budget cannot change its budget, and a Meta campaign whose budget is on its ad sets cannot either (409). Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: projectAdCampaignParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: updateAdCampaignRequestSchema },
        },
      },
    },
    responses: {
      204: { description: "Campaign updated" },
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
    const { status, dailyBudget } = c.req.valid("json");

    try {
      await updateProjectAdCampaign({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        accountId,
        campaignId,
        status,
        dailyBudget,
      });
      return empty(c);
    } catch (error) {
      return mapAdsServiceError(error);
    }
  });
}
