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
  putAdMarketProfileRequestSchema,
  putAdMarketProfileResponseSchema,
} from "@/schemas/project-ad-market.schema";
import { projectSocialConnectionProjectParamsSchema } from "@/schemas/project-social-connection.schema";
import { setProjectAdMarketProfile } from "@/services/project-ad-market.service";

import { mapProjectAdServiceError } from "../route-helpers.js";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: "/{id}/ads/market",
    description:
      "Save a Project's ads market profile, replacing the previous one. Needs an open Project (409 otherwise). Requires an interactive user session in the Project's Workspace.",
    tags: ["Projects"],
    request: {
      params: projectSocialConnectionProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: putAdMarketProfileRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        putAdMarketProfileResponseSchema,
        "Saved Project ads market profile",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
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
    const { keywords, countryCode, languageCode } = c.req.valid("json");

    try {
      const profile = await setProjectAdMarketProfile({
        projectId,
        workspaceId: workspaceContext.workspaceId,
        keywords,
        countryCode,
        languageCode,
      });
      return ok(c, putAdMarketProfileResponseSchema.parse({ profile }));
    } catch (error) {
      return mapProjectAdServiceError(error);
    }
  });
}
