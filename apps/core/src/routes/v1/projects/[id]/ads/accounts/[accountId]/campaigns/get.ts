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
  listAdCampaignsQuerySchema,
  listAdCampaignsResponseSchema,
  projectAdAccountParamsSchema,
} from "@/schemas/project-ad-account.schema";
import { listProjectAdCampaigns } from "@/services/project-ad-accounts.service";

import { mapProjectAdServiceError } from "../../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/ads/accounts/{accountId}/campaigns",
    description:
      "List the campaigns of an ad account attached to a Project, with spend, impressions, clicks, CTR, CPC and conversions over the range. Money is a decimal in the account currency. Lists at most 1000 Google campaigns and 1000 Meta campaigns. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: projectAdAccountParamsSchema,
      query: listAdCampaignsQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        listAdCampaignsResponseSchema,
        "Ad account campaigns",
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
    const { range } = c.req.valid("query");

    try {
      const result = await listProjectAdCampaigns({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        accountId,
        range,
      });
      return ok(c, listAdCampaignsResponseSchema.parse(result));
    } catch (error) {
      return mapProjectAdServiceError(error);
    }
  });
}
