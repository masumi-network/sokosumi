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
  projectCompetitorsSchema,
  projectCompetitorUpdateSchema,
} from "@/schemas/project-competitors.schema";
import { updateTrackedCompetitor } from "@/services/competitors.service";

import { requireWorkspaceProject } from "../../access";
import { competitorsResponse } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}/competitors/{competitorId}",
    operationId: "updateProjectCompetitor",
    tags: ["Projects"],
    description:
      "A member changes a tracked competitor: its name, website, pricing page or accounts. Null or an empty string clears a field.",
    request: {
      params: projectCompetitorParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: projectCompetitorUpdateSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(projectCompetitorsSchema, "Competitor changed"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse(
        "The name is already tracked, or a CMO project is read-only",
      ),
      422: jsonErrorResponse("Not a web address or an account"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { userId } = await requireAuthorizedUserContext(c.var.authContext);
    const { id, competitorId } = c.req.valid("param");
    const { projectId } = await requireWorkspaceProject(c, id, userId);
    await updateTrackedCompetitor(projectId, competitorId, c.req.valid("json"));
    return ok(c, await competitorsResponse(projectId));
  });
}
