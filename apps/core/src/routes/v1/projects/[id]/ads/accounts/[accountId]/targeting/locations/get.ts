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
  listGoogleLocationsResponseSchema,
  projectAdAccountParamsSchema,
  searchGoogleLocationsQuerySchema,
} from "@/schemas/project-ad-account.schema";
import { searchProjectAdLocations } from "@/services/project-ad-accounts.service";

import { mapAdsServiceError } from "../../../../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/ads/accounts/{accountId}/targeting/locations",
    description:
      "Search the Google locations of an ad account's Google Ads customer by name (`q`) or look them up by geo target constant id (`ids`); send exactly one. Returns at most 20 enabled locations; `q` is ordered by name. Google Ads accounts only: a Meta account is 404. Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: projectAdAccountParamsSchema,
      query: searchGoogleLocationsQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        listGoogleLocationsResponseSchema,
        "Matching Google locations",
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
    const { q, ids } = c.req.valid("query");
    const scope = {
      projectId,
      workspaceId: workspaceContext.workspaceId,
      accountId,
    };

    try {
      const result = await searchProjectAdLocations(
        q === undefined
          ? { ...scope, ids: (ids ?? "").split(",") }
          : { ...scope, q },
      );
      return ok(c, listGoogleLocationsResponseSchema.parse(result));
    } catch (error) {
      return mapAdsServiceError(error);
    }
  });
}
