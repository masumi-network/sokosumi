import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { projectSocialConnectionParamsSchema } from "@/schemas/project-social-connection.schema";
import {
  refreshSocialAccountStatisticsRequestSchema,
  refreshSocialAccountStatisticsResponseSchema,
} from "@/schemas/social-account-statistics.schema";
import { refreshSocialAccountStatistics } from "@/services/social-account-statistics.service";
import { mapProjectSocialConnectionServiceError } from "../../../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/social-connections/{connectionId}/statistics/refresh",
    tags: ["Projects"],
    description:
      "Refresh account metrics and one page of provider-authored published posts through the connected account. continueHistory uses only the stored provider cursor; it never publishes or edits posts. Failures preserve prior data and expose history coverage.",
    request: {
      params: projectSocialConnectionParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: refreshSocialAccountStatisticsRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        refreshSocialAccountStatisticsResponseSchema,
        "Social account statistics refreshed",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);
export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const actor = await requireSocialPostActor(c.var.authContext);
    await requireSocialBetaAccess(actor.userId, prisma);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, connectionId } = c.req.valid("param");
    try {
      const result = await refreshSocialAccountStatistics({
        projectId,
        workspaceId,
        userId: actor.userId,
        connectionId,
        ...c.req.valid("json"),
      });
      return ok(c, refreshSocialAccountStatisticsResponseSchema.parse(result));
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
