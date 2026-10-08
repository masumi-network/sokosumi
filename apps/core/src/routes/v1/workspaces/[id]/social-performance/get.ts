import { createRoute, z } from "@hono/zod-openapi";
import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import { requireSocialPostActor } from "@/helpers/social-post-access";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { organizationProductSeatMiddleware } from "@/middleware/organization-product-seat";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { mapProjectSocialConnectionServiceError } from "@/routes/v1/projects/[id]/social-connections/route-helpers";
import {
  workspaceSocialPerformanceQuerySchema,
  workspaceSocialPerformanceResponseSchema,
} from "@/schemas/social-performance.schema";
import { listWorkspaceSocialPerformance } from "@/services/social-performance.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/social-performance",
    tags: ["Workspaces"],
    middleware: [organizationProductSeatMiddleware],
    description:
      "Read complete cached active-workspace publication-cohort performance, deduplicated by provider and external post ID using the freshest measured copy. Per-account/project comparisons overlap and are not additive; follower observations remain per connection. The project catalog remains complete when filtered. Read comparisons, posting-time samples, and measured daily snapshots. Totals are latest lifetime counters for posts published in each range, not engagement earned during that range. Engagement-rate formulas and measurement coverage are explicit. Returns up to 100 ranked posts per offset page; aggregate summaries cover the whole matching cohort. GET does not refresh providers or backfill historical samples.",
    request: {
      params: z.object({ id: z.uuid() }),
      query: workspaceSocialPerformanceQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        workspaceSocialPerformanceResponseSchema,
        "Social account performance",
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
    try {
      const result = await listWorkspaceSocialPerformance({
        workspaceId,
        ...c.req.valid("query"),
      });
      return ok(c, workspaceSocialPerformanceResponseSchema.parse(result));
    } catch (error) {
      return mapProjectSocialConnectionServiceError(error);
    }
  });
}
