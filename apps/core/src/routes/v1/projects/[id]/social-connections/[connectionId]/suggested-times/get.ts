import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { projectSocialConnectionParamsSchema } from "@/schemas/project-social-connection.schema";
import {
  socialConnectionSuggestedTimesQuerySchema,
  socialConnectionSuggestedTimesSchema,
} from "@/schemas/social-account-statistics.schema";
import { listSuggestedPostingTimes } from "@/services/social-account-statistics.service";
import { mapProjectSocialConnectionServiceError } from "../../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-connections/{connectionId}/suggested-times",
    tags: ["Projects"],
    description:
      "Suggest two or three posting hours from this account's cached Performance history. Empty when there is not enough measured history. Hours are wall-clock values in the requested IANA time zone.",
    request: {
      params: projectSocialConnectionParamsSchema,
      query: socialConnectionSuggestedTimesQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        socialConnectionSuggestedTimesSchema,
        "Suggested posting hours",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    await requireSocialPostActor(c.var.authContext);

    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, connectionId } = c.req.valid("param");
    const { timezone } = c.req.valid("query");
    try {
      const result = await listSuggestedPostingTimes({
        projectId,
        workspaceId,
        connectionId,
        timezone,
      });
      return ok(c, socialConnectionSuggestedTimesSchema.parse(result));
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
