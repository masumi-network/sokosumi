import { createRoute } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { COMPETITOR_CHECK_CREDITS } from "@/lib/competitors/price";
import { recordCoreWarning, runAsBackgroundWork } from "@/lib/evlog";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import {
  projectCompetitorChecksSchema,
  projectCompetitorsParamsSchema,
  projectCompetitorsSchema,
} from "@/schemas/project-competitors.schema";
import { runProjectCompetitorCheck } from "@/services/competitor-check.service";
import { setCompetitorChecks } from "@/services/competitors.service";

import { requireWorkspaceProject } from "../../access";
import { competitorsResponse } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/competitors/checks",
    operationId: "setProjectCompetitorChecks",
    tags: ["Projects"],
    description: `A member turns the Project's weekly competitor check on or off. On, the first check starts at once and each tracked competitor is checked once a week (its website and pricing page, news, ads and Instagram) for ${COMPETITOR_CHECK_CREDITS} credits a competitor, charged to the Project's organization, or to the person in a personal workspace. Off keeps what the checks found.`,
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

/**
 * The first check does not wait for the hourly sync. It runs only when one
 * is due, so turning the check on again starts and charges nothing.
 */
function startFirstCheck(projectId: string): void {
  waitUntil(
    runAsBackgroundWork(() =>
      runProjectCompetitorCheck(projectId).catch((error: unknown) =>
        // The error can quote a page or an article.
        recordCoreWarning(
          { operation: "competitor_first_check", project: { id: projectId } },
          {
            message: "The first competitor check did not run",
            why: "Running the check right after it was turned on threw",
            fix: "The hourly competitor sync tries again; a check that started is redone after an hour and charged once. If it repeats, look up the error name and code under failure.",
          },
          { failure: messageSafeErrorFields(error) },
        ),
      ),
    ),
  );
}

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { userId } = await requireAuthorizedUserContext(c.var.authContext);
    const { projectId } = await requireWorkspaceProject(
      c,
      c.req.valid("param").id,
      userId,
    );
    const { on } = c.req.valid("json");
    await setCompetitorChecks(projectId, on);
    if (on) startFirstCheck(projectId);
    return ok(c, await competitorsResponse(projectId));
  });
}
