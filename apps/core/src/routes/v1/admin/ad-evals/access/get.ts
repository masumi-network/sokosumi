import { createRoute, z } from "@hono/zod-openapi";

import { requireAdEvalsAdminAccess } from "@/helpers/ad-evals-admin-access";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";

const accessSchema = z.object({ hasAccess: z.literal(true) });

const route = createRoute({
  method: "get",
  path: "/access",
  operationId: "getAdminAdEvalsAccess",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(accessSchema, "Ad evals admin access allowed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const admin = requireAdminAuthContext(c.var.authContext);
    await requireAdEvalsAdminAccess(admin.userId, prisma);

    return ok(c, accessSchema.parse({ hasAccess: true }));
  });
}
