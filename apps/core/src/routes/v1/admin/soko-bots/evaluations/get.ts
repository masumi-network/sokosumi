import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { adminSokoBotModelEvaluationsSchema } from "@/schemas/soko-bot.schema";
import { listSokoBotModelEvaluations } from "@/services/soko-bot-model-evaluation.service";

const evaluationsRoute = createRoute({
  method: "get",
  path: "/evaluations",
  operationId: "getAdminSokoBotModelEvaluations",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(
      adminSokoBotModelEvaluationsSchema,
      "Recent judge and routing model evaluations",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(evaluationsRoute, async (c) => {
    return ok(
      c,
      adminSokoBotModelEvaluationsSchema.parse(
        await listSokoBotModelEvaluations(),
      ),
    );
  });
}
