import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { evalRunReportSchema } from "@/schemas/eval.schema";
import { getEvalRunReport } from "@/services/evals/eval-runs.service";
import { evalHttpError, toEvalResultDto, toEvalRunDto } from "../../helpers.js";

const getRunRoute = createRoute({
  method: "get",
  path: "/runs/{id}",
  operationId: "getAdminEvalRun",
  tags: ["Admin"],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: jsonSuccessResponse(
      evalRunReportSchema,
      "Every case of the run against the daily runs on main before it",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(getRunRoute, async (c) => {
    const { id } = c.req.valid("param");
    const report = await getEvalRunReport(id).catch(evalHttpError);
    return ok(
      c,
      evalRunReportSchema.parse({
        ...report,
        run: toEvalRunDto(report.run),
        cases: report.cases.map((evalCase) => ({
          ...evalCase,
          results: evalCase.results.map(toEvalResultDto),
        })),
      }),
    );
  });
}
