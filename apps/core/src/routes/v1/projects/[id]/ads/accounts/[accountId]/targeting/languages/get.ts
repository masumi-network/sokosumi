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
  listGoogleLanguagesResponseSchema,
  projectAdAccountParamsSchema,
} from "@/schemas/project-ad-account.schema";
import { listProjectAdLanguages } from "@/services/project-ad-accounts.service";

import { mapAdsServiceError } from "../../../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/ads/accounts/{accountId}/targeting/languages",
    description:
      "List the languages a Google campaign of the ad account can target, sorted by name. Google Ads accounts only: a Meta account is 404. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: { params: projectAdAccountParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        listGoogleLanguagesResponseSchema,
        "Targetable Google languages",
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

    try {
      const result = await listProjectAdLanguages({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        accountId,
      });
      return ok(c, listGoogleLanguagesResponseSchema.parse(result));
    } catch (error) {
      return mapAdsServiceError(error);
    }
  });
}
