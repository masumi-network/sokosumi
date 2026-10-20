import { createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { forbidden, internalServerError } from "@/helpers/error";
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
import { projectSocialConnectionProjectParamsSchema } from "@/schemas/project-social-connection.schema";
import {
  socialAccountStatisticsPageSchema,
  socialAccountStatisticsQuerySchema,
} from "@/schemas/social-account-statistics.schema";
import { listSocialAccountStatistics } from "@/services/social-account-statistics.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-connections/statistics",
    tags: ["Workspaces"],
    description:
      "Read cached account metrics and provider-authored published posts for every connected account in the active workspace. Same page shape as the project statistics route. GET does not fetch provider history.",
    request: {
      params: projectSocialConnectionProjectParamsSchema,
      query: socialAccountStatisticsQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        socialAccountStatisticsPageSchema,
        "Workspace social account statistics",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
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
    const { id } = c.req.valid("param");
    if (id !== workspaceId)
      throw forbidden("Performance is scoped to the active workspace");
    const { publishedFrom, publishedUntil, ...query } = c.req.valid("query");
    try {
      const result = await listSocialAccountStatistics({
        workspaceId,
        ...query,
        publishedFrom: publishedFrom ? new Date(publishedFrom) : undefined,
        publishedUntil: publishedUntil ? new Date(publishedUntil) : undefined,
      });
      return ok(c, socialAccountStatisticsPageSchema.parse(result));
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      throw internalServerError("Unable to read social account statistics.");
    }
  });
}
