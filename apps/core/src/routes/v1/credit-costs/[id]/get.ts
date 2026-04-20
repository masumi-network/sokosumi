import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  creditCostSchema,
  mapCreditCostForApi,
} from "@/schemas/credit-cost.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "clxx123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  description: "Retrieve a credit cost by id (admin only)",
  tags: ["Credit Costs"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(creditCostSchema, "Retrieve credit cost"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const record = await prisma.creditCost.findUnique({
      where: { id },
    });

    if (!record) {
      throw notFound("Credit cost not found");
    }

    return ok(c, creditCostSchema.parse(mapCreditCostForApi(record)));
  });
}
