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
  projectCompetitorRestoreSchema,
  projectCompetitorsSchema,
} from "@/schemas/project-competitors.schema";
import { restoreTrackedCompetitor } from "@/services/competitors.service";

import { requireWorkspaceProject } from "../../../access";
import { competitorsResponse } from "../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/competitors/{competitorId}/restore",
    operationId: "restoreProjectCompetitor",
    tags: ["Projects"],
    description:
      "Undoes one removal: the competitor comes back as it was stored, with what the checks found. `removedAt` is the one the remove answered with.",
    request: {
      params: projectCompetitorParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: projectCompetitorRestoreSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(projectCompetitorsSchema, "Competitor restored"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse(
        "The removal is no longer the latest, the name is taken, the limit is reached, or a CMO project is read-only",
      ),
      422: jsonErrorResponse("No removal given"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { userId } = await requireAuthorizedUserContext(c.var.authContext);
    const { id, competitorId } = c.req.valid("param");
    const { projectId } = await requireWorkspaceProject(c, id, userId);
    await restoreTrackedCompetitor(
      projectId,
      competitorId,
      new Date(c.req.valid("json").removedAt),
    );
    return ok(c, await competitorsResponse(projectId));
  });
}
