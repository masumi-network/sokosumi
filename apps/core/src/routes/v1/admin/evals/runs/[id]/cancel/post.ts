import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { evalRunSchema } from "@/schemas/eval.schema";
import { cancelEvalRun } from "@/services/evals/eval-runs.service";
import { evalHttpError, toEvalRunDto } from "../../../helpers.js";

const cancelRunRoute = createRoute({
  method: "post",
  path: "/runs/{id}/cancel",
  operationId: "cancelAdminEvalRun",
  tags: ["Admin"],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: jsonSuccessResponse(
      evalRunSchema,
      "The run, cancelled; cases not yet finished are skipped",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(cancelRunRoute, async (c) => {
    const { id } = c.req.valid("param");
    const run = await cancelEvalRun(id).catch(evalHttpError);
    return ok(c, evalRunSchema.parse(toEvalRunDto(run)));
  });
}
