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
import {
  createAdCampaignRequestSchema,
  createAdCampaignResponseSchema,
  projectAdAccountParamsSchema,
} from "@/schemas/project-ad-account.schema";
import { createProjectAdCampaign } from "@/services/project-ad-accounts.service";

import { mapAdsServiceError } from "../../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/ads/accounts/{accountId}/campaigns",
    description:
      "Create a campaign in an attached ad account. The campaign is always created paused. dailyBudget is a decimal in the account currency. Meta accounts require an objective and take no google spec (422 otherwise); Google accounts require a google spec (a Search campaign with locations, languages, keywords and a responsive search ad, created in one atomic call) and take no objective (422 otherwise). A Google validation or policy failure is returned as 422 with Google's message. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: projectAdAccountParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: createAdCampaignRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        createAdCampaignResponseSchema,
        "Campaign created (paused)",
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
    const { id: projectId, accountId } = c.req.valid("param");
    const { name, dailyBudget, objective, google } = c.req.valid("json");

    try {
      const campaign = await createProjectAdCampaign({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        accountId,
        name,
        dailyBudget,
        objective,
        google,
      });
      return created(c, createAdCampaignResponseSchema.parse(campaign));
    } catch (error) {
      return mapAdsServiceError(error);
    }
  });
}
