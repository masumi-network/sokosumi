import { createRoute } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  projectCompetitorCheckRunSchema,
  projectCompetitorsParamsSchema,
} from "@/schemas/project-competitors.schema";
import { runProjectCompetitorCheck } from "@/services/competitor-check.service";

import { requireWorkspaceProject } from "../../access";
import { competitorsResponse } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/competitors/check",
    operationId: "runProjectCompetitorCheck",
    tags: ["Projects"],
    description:
      "Runs the Project's weekly competitor check now when one is due, instead of waiting for the hourly sync: the first check after turning it on, or the next one once the last is a week old. It is charged like every weekly check, once. Answers when the check has finished, which takes up to a few minutes.",
    request: { params: projectCompetitorsParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        projectCompetitorCheckRunSchema,
        "How the check went, and the page after it",
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
    const { projectId } = await requireWorkspaceProject(
      c,
      c.req.valid("param").id,
      userId,
    );
    const outcome = await runProjectCompetitorCheck(projectId);
    return ok(c, {
      outcome,
      competitors: await competitorsResponse(projectId),
    });
  });
}
