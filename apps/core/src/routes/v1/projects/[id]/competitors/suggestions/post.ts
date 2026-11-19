import { createRoute } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  projectCompetitorSuggestionsSchema,
  projectCompetitorsParamsSchema,
} from "@/schemas/project-competitors.schema";
import { suggestCompetitors } from "@/services/competitor-suggestions.service";

import { requireWorkspaceProject } from "../../access";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/competitors/suggestions",
    operationId: "suggestProjectCompetitors",
    tags: ["Projects"],
    description:
      "Finds competitors the Project could track, from its website: companies that sell the same kind of thing to the same customers, the best known first, without the ones it tracks or removed. Nothing is added; the member adds the ones they pick. Free. Takes up to half a minute.",
    request: { params: projectCompetitorsParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        projectCompetitorSuggestionsSchema,
        "Competitors to pick from",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("CMO project is read-only"),
      422: jsonErrorResponse(
        "The Project has no website, or the search is not available",
      ),
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
    return ok(c, { suggestions: await suggestCompetitors(projectId) });
  });
}
