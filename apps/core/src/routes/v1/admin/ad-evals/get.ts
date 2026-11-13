import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { adminAdEvalsDashboardSchema } from "@/schemas/ad-evals.schema";
import { getAdminAdEvalsDashboard } from "@/services/ad-evals.service";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "getAdminAdEvals",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(
      adminAdEvalsDashboardSchema,
      "Ad leaderboard and judge agreement for consenting workspaces",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    return ok(
      c,
      adminAdEvalsDashboardSchema.parse(await getAdminAdEvalsDashboard()),
    );
  });
}
