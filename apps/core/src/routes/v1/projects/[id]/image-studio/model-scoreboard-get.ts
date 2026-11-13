import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioProjectParamsSchema } from "@/schemas/project-image-studio.schema";
import { studioModelScoreboardSchema } from "@/schemas/studio-compare.schema";
import { getStudioModelScoreboard } from "@/services/studio-compare.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/image-studio/model-scoreboard",
    operationId: "getStudioModelScoreboard",
    description:
      "Project model ranking from workspace members' cross-model picks, in chronological order. Ties count as half a win; both bad counts as no wins and leaves Elo unchanged. Same-model variations do not rank models. Fewer than ten comparisons is provisional.",
    tags: ["Projects"],
    request: { params: imageStudioProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(studioModelScoreboardSchema, "Model scoreboard"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Project not found"),
      422: jsonErrorResponse("Invalid parameters"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const scoreboard = await getStudioModelScoreboard({
      projectId,
      workspaceId,
      userId,
    });
    return ok(c, studioModelScoreboardSchema.parse(scoreboard));
  });
}
