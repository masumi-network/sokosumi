import { createRoute, z } from "@hono/zod-openapi";
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
  attachProjectAdAccountsRequestSchema,
  projectAdAccountSchema,
} from "@/schemas/project-ad-account.schema";
import { projectSocialConnectionProjectParamsSchema } from "@/schemas/project-social-connection.schema";
import { attachProjectAdAccounts } from "@/services/project-ad-accounts.service";

import { mapAdsServiceError } from "../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/ads/accounts",
    description:
      "Attach ad accounts from a finalized connection to a Project. Only accounts the connection can reach are accepted; attaching again is a no-op. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: projectSocialConnectionProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: attachProjectAdAccountsRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(projectAdAccountSchema),
        "Attached Project ad accounts",
      ),
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
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    // Ads share the social beta gate.
    await requireSocialBetaAccess(userContext.userId, prisma);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const { adConnectionId, externalAccountIds } = c.req.valid("json");

    try {
      const accounts = await attachProjectAdAccounts({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        adConnectionId,
        externalAccountIds,
      });
      return ok(c, z.array(projectAdAccountSchema).parse(accounts));
    } catch (error) {
      return mapAdsServiceError(error);
    }
  });
}
