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
import { projectAdAccountParamsSchema } from "@/schemas/project-ad-account.schema";
import { detachProjectAdAccount } from "@/services/project-ad-accounts.service";

import { mapProjectAdServiceError } from "../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/{id}/ads/accounts/{accountId}",
    description:
      "Detach an ad account from a Project. When it was the last account on its connection, the provider authorization is revoked too. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: { params: projectAdAccountParamsSchema },
    responses: {
      204: { description: "Ad account detached" },
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

    try {
      await detachProjectAdAccount({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        accountId,
      });
      return empty(c);
    } catch (error) {
      return mapProjectAdServiceError(error);
    }
  });
}
