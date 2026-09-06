import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  creditCostSchema,
  mapCreditCostForApi,
} from "@/schemas/credit-cost.schema";

const route = createRoute({
  method: "get",
  path: "/",
  description: "List all credit costs (admin only)",
  tags: ["Credit Costs"],
  responses: {
    200: jsonSuccessResponse(
      z.array(creditCostSchema),
      "Retrieve all credit costs",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);

    const items = await prisma.creditCost.findMany();

    const mapped = items.map(mapCreditCostForApi);
    return ok(c, z.array(creditCostSchema).parse(mapped));
  });
}
