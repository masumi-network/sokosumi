import { createRoute } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  projectCompetitorChecksSchema,
  projectCompetitorsParamsSchema,
  projectCompetitorsSchema,
} from "@/schemas/project-competitors.schema";
import { setCompetitorChecks } from "@/services/competitors.service";

import { requireWorkspaceProject } from "../../access";
import { competitorsResponse } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/competitors/checks",
    operationId: "setProjectCompetitorChecks",
    tags: ["Projects"],
    description:
      "A member turns the Project's weekly competitor check on or off. On, each tracked competitor is checked once a week (its website and pricing page, news, ads and Instagram) for 3 credits a competitor, charged to the Project's organization, or to the person in a personal workspace. Off keeps what the checks found.",
    request: {
      params: projectCompetitorsParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: projectCompetitorChecksSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(projectCompetitorsSchema, "Weekly check set"),
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
    const { projectId } = await requireWorkspaceProject(
      c,
      c.req.valid("param").id,
      userId,
    );
    await setCompetitorChecks(projectId, c.req.valid("json").on);
    return ok(c, await competitorsResponse(projectId));
  });
}
