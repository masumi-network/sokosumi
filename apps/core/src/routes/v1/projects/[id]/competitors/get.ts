import { createRoute } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  projectCompetitorsParamsSchema,
  projectCompetitorsSchema,
} from "@/schemas/project-competitors.schema";

import { requireWorkspaceProject } from "../access";
import { competitorsResponse } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/competitors",
    operationId: "getProjectCompetitors",
    tags: ["Projects"],
    description:
      "The competitors the Project tracks, this week's moves, what the weekly checks of the last 35 days found with their sources, the Instagram scoreboard, and whether the weekly check is on and what it costs. A pure read.",
    request: { params: projectCompetitorsParamsSchema },
    responses: {
      200: jsonSuccessResponse(projectCompetitorsSchema, "Tracked competitors"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { userId } = await requireAuthorizedUserContext(c.var.authContext);
    const { projectId } = await requireWorkspaceProject(
      c,
      c.req.valid("param").id,
      userId,
    );
    return ok(c, await competitorsResponse(projectId));
  });
}
