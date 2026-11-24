import { createRoute } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  projectCompetitorParamsSchema,
  projectCompetitorRemovalSchema,
} from "@/schemas/project-competitors.schema";
import { removeTrackedCompetitor } from "@/services/competitors.service";

import { requireWorkspaceProject } from "../../access";
import { competitorsResponse } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/competitors/{competitorId}",
    operationId: "removeProjectCompetitor",
    tags: ["Projects"],
    description:
      "A member stops tracking a competitor. What the checks found about it is kept. `removal` names this removal for the restore operation.",
    request: { params: projectCompetitorParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        projectCompetitorRemovalSchema,
        "Competitor removed",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("CMO project is read-only"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { userId } = await requireAuthorizedUserContext(c.var.authContext);
    const { id, competitorId } = c.req.valid("param");
    const { projectId } = await requireWorkspaceProject(c, id, userId);
    const removal = await removeTrackedCompetitor(projectId, competitorId);
    return ok(c, { ...(await competitorsResponse(projectId)), removal });
  });
}
