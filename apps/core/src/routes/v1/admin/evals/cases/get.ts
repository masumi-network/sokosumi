import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { evalCaseDefinitionSchema } from "@/schemas/eval.schema";
import { EVAL_CASES } from "@/services/evals/eval-cases";

const listCasesRoute = createRoute({
  method: "get",
  path: "/cases",
  operationId: "listAdminEvalCases",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(
      z.array(evalCaseDefinitionSchema),
      "Every eval case, in the order a run runs them",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listCasesRoute, async (c) =>
    ok(
      c,
      EVAL_CASES.map((evalCase) => ({
        id: evalCase.id,
        suite: evalCase.suite,
        area: evalCase.area,
        title: evalCase.title,
        intent: evalCase.intent,
        kind: evalCase.kind,
        requires: evalCase.requires ?? null,
      })),
    ),
  );
}
