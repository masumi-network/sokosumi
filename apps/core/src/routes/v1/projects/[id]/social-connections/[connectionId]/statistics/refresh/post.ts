import { createRoute } from "@hono/zod-openapi";
import { badRequest, notFound } from "@/helpers/error";
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
import { listSocialAccountStatistics } from "@/services/social-account-statistics.service";
import { requestSocialAccountRefresh } from "@/services/social-account-sync";
import { mapProjectSocialConnectionServiceError } from "../../../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/social-connections/{connectionId}/statistics/refresh",
    tags: ["Projects"],
    description:
      "Queue a background refresh of cached account statistics. The response is stored data plus sync state and never waits on providers. Cron continues history.",
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
        "Social account refresh accepted",
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
      const requested = await requestSocialAccountRefresh({
        projectId,
        workspaceId,
        connectionId,
        trigger: "manual",
      });
      if (requested.isErr()) {
        if (requested.error.code === "not_found") {
          throw notFound("Project social connection not found");
        }
        throw badRequest("Reconnect the account before refreshing statistics");
      }
      const page = await listSocialAccountStatistics({
        projectId,
        workspaceId,
        connectionId,
        limit: 1,
      });
      const account = page.accounts.find((row) => row.id === connectionId);
      if (!account) throw notFound("Project social connection not found");
      return ok(
        c,
        refreshSocialAccountStatisticsResponseSchema.parse({
          account,
          importedPostCount: 0,
        }),
      );
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
