import { createRoute } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  projectCompetitorCreateSchema,
  projectCompetitorsParamsSchema,
  projectCompetitorsSchema,
} from "@/schemas/project-competitors.schema";
import { addTrackedCompetitor } from "@/services/competitors.service";

import { requireWorkspaceProject } from "../access";
import { competitorsResponse } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/competitors",
    operationId: "addProjectCompetitor",
    tags: ["Projects"],
    description:
      "A member adds a competitor to track, up to the limit. The next weekly check reads it.",
    request: {
      params: projectCompetitorsParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: projectCompetitorCreateSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(projectCompetitorsSchema, "Competitor added"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse(
        "Already tracked, the limit is reached, or a CMO project is read-only",
      ),
      422: jsonErrorResponse("Not a web address or an account"),
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
    await addTrackedCompetitor(projectId, c.req.valid("json"));
    return ok(c, await competitorsResponse(projectId));
  });
}
