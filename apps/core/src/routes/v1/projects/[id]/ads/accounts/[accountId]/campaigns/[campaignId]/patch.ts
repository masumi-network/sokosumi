import { createRoute } from "@hono/zod-openapi";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import {
  requirePersonApproval,
  requireUserAuthContext,
} from "@/middleware/auth";
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
      "Pause or resume a campaign and/or change its daily budget (decimal in the account currency). The campaign must belong to the attached ad account. A Google campaign on a shared budget cannot change its budget, and a Meta campaign whose budget is on its ad sets cannot either (409). Open to a person and to an agent (user API key, OAuth or MCP token) in the Project's Workspace; Coworker keys get 403. An agent (ADR 0077) may pause at any time and change the budget only while the campaign is paused (409 otherwise); it sends a status or a budget, not both (400); only a person resumes, so an agent's resume is 403 `person_approval_required` with `webUrl`, the Sokosumi page where the person does it.",
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
      400: jsonErrorResponse("Bad Request"),
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
    const userContext = requireUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, accountId, campaignId } = c.req.valid("param");
    const { status, dailyBudget } = c.req.valid("json");

    // ADR 0077: any credential but a browser session is an agent.
    const agent = userContext.authenticationMethod !== "session";
    if (agent && status !== undefined && dailyBudget !== undefined) {
      throw badRequest(
        "An agent changes a campaign's status or its budget, one per call",
      );
    }
    if (status === "ACTIVE") {
      requirePersonApproval(
        c.var.authContext,
        `/ads?${new URLSearchParams({ projectId, tab: "campaigns", account: accountId })}`,
      );
    }

    try {
      await updateProjectAdCampaign({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        accountId,
        campaignId,
        status,
        dailyBudget,
        onlyWhilePaused: agent && dailyBudget !== undefined,
      });
      return empty(c);
    } catch (error) {
      return mapAdsServiceError(error);
    }
  });
}
