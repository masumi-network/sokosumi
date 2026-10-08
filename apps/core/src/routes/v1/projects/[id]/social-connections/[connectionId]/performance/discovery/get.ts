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
  socialPerformanceDiscoveryQuerySchema,
  socialPerformanceDiscoveryResponseSchema,
} from "@/schemas/social-performance-research.schema";
import { readSocialPerformanceDiscovery } from "@/services/social-performance-research.service";
import { mapProjectSocialConnectionServiceError } from "../../../route-helpers.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-connections/{connectionId}/performance/discovery",
    tags: ["Projects"],
    description:
      "Search a bounded page of public X posts from the last seven days through the selected active connection. Filters by topic phrase, public handle, language and format; follower-size and metric thresholds and ranking apply within the fetched sample. Returns original post evidence and explicit coverage without persisting external profiles.",
    request: {
      params: projectSocialConnectionParamsSchema,
      query: socialPerformanceDiscoveryQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        socialPerformanceDiscoveryResponseSchema,
        "Recent public X discovery sample",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      503: jsonErrorResponse("Service Unavailable"),
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
      return ok(
        c,
        await readSocialPerformanceDiscovery({
          projectId,
          workspaceId,
          connectionId,
          ...c.req.valid("query"),
        }),
      );
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
