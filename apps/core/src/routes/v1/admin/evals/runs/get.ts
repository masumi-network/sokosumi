import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { evalRunListItemSchema } from "@/schemas/eval.schema";
import { listEvalRuns } from "@/services/evals/eval-runs.service";
import { toEvalRunDto } from "../helpers.js";

const listRunsRoute = createRoute({
  method: "get",
  path: "/runs",
  operationId: "listAdminEvalRuns",
  tags: ["Admin"],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
  },
  responses: {
    200: jsonSuccessResponse(
      z.array(evalRunListItemSchema),
      "Eval runs with their scores per suite, newest first",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listRunsRoute, async (c) => {
    const { limit } = c.req.valid("query");
    const runs = await listEvalRuns(limit);
    return ok(
      c,
      z.array(evalRunListItemSchema).parse(
        runs.map((run) => ({
          ...toEvalRunDto(run),
          scores: run.scores,
          costUsd: run.costUsd,
        })),
      ),
    );
  });
}
