import { createRoute } from "@hono/zod-openapi";

import { requireAdEvalsAdminAccess } from "@/helpers/ad-evals-admin-access";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
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
    const admin = requireAdminAuthContext(c.var.authContext);
    await requireAdEvalsAdminAccess(admin.userId, prisma);

    return ok(
      c,
      adminAdEvalsDashboardSchema.parse(await getAdminAdEvalsDashboard()),
    );
  });
}
