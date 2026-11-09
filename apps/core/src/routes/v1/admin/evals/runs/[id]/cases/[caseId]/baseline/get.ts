import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { evalCaseBaselineSchema } from "@/schemas/eval.schema";
import { getEvalCaseBaseline } from "@/services/evals/eval-runs.service";
import { evalHttpError, toEvalResultDto } from "../../../../../helpers.js";

const getBaselineRoute = createRoute({
  method: "get",
  path: "/runs/{id}/cases/{caseId}/baseline",
  operationId: "getAdminEvalCaseBaseline",
  tags: ["Admin"],
  request: {
    params: z.object({ id: z.uuid(), caseId: z.string().min(1).max(120) }),
  },
  responses: {
    200: jsonSuccessResponse(
      evalCaseBaselineSchema,
      "The case in the daily run on main before this run, to compare outputs",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(getBaselineRoute, async (c) => {
    const { id, caseId } = c.req.valid("param");
    const baseline = await getEvalCaseBaseline(id, caseId).catch(evalHttpError);
    return ok(
      c,
      evalCaseBaselineSchema.parse({
        run: baseline?.run ?? null,
        results: (baseline?.results ?? []).map(toEvalResultDto),
      }),
    );
  });
}
