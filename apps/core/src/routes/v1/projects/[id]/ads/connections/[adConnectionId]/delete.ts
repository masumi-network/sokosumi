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
import { projectAdConnectionParamsSchema } from "@/schemas/project-ad-account.schema";
import { discardProjectAdConnection } from "@/services/project-ad-accounts.service";

import { mapAdsServiceError } from "../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/{id}/ads/connections/{adConnectionId}",
    description:
      "Discard an ad connection that has no ad accounts, for example when the account picker is closed without attaching: the provider authorization is revoked and the connection is deleted. A connection with ad accounts is refused; detach its ad accounts instead. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: { params: projectAdConnectionParamsSchema },
    responses: {
      204: { description: "Ad connection discarded" },
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
    const { id: projectId, adConnectionId } = c.req.valid("param");

    try {
      await discardProjectAdConnection({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        adConnectionId,
      });
      return empty(c);
    } catch (error) {
      return mapAdsServiceError(error);
    }
  });
}
