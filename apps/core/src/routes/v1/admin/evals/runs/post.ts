import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { createEvalRunBodySchema, evalRunSchema } from "@/schemas/eval.schema";
import { createEvalRun } from "@/services/evals/eval-runs.service";
import { evalHttpError, toEvalRunDto } from "../helpers.js";

const createRunRoute = createRoute({
  method: "post",
  path: "/runs",
  operationId: "createAdminEvalRun",
  tags: ["Admin"],
  request: {
    body: {
      content: { "application/json": { schema: createEvalRunBodySchema } },
      required: true,
    },
  },
  responses: {
    201: jsonSuccessResponse(
      evalRunSchema,
      "The run, queued behind any run still in progress",
    ),
    400: jsonErrorResponse("Unknown case, suite or version"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    422: jsonErrorResponse("Invalid body"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(createRunRoute, async (c) => {
    const auth = requireAdminAuthContext(c.var.authContext);
    const body = c.req.valid("json");
    const run = await createEvalRun({
      trigger: "MANUAL",
      suites: body.suites,
      caseIds: body.caseIds,
      repeats: body.repeats,
      label: body.label,
      startedByUserId: auth.userId,
      sokoBotVersionId: body.sokoBotVersionId,
      cusoVersionId: body.cusoVersionId,
      commit: { sha: body.commitSha, message: body.commitMessage },
    }).catch(evalHttpError);
    return created(c, evalRunSchema.parse(toEvalRunDto(run)));
  });
}
