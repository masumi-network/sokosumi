import { createRoute, z } from "@hono/zod-openapi";
import { convertCreditsToCents } from "@sokosumi/utils";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/routes/v1/coworkers/admin-guard";
import {
  creditCostSchema,
  mapCreditCostForApi,
  patchCreditCostRequestSchema,
} from "@/schemas/credit-cost.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "clxx123",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/{id}",
  description: "Update a credit cost (admin only)",
  tags: ["Credit Costs"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: patchCreditCostRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(creditCostSchema, "Update credit cost"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    await requireAdminAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const current = await prisma.creditCost.findUnique({ where: { id } });
    if (!current) {
      throw notFound("Credit cost not found");
    }

    const centsPerUnit = convertCreditsToCents(body.creditsPerUnit);
    const updated = await prisma.creditCost.update({
      where: { id },
      data: { centsPerUnit },
    });

    return ok(c, creditCostSchema.parse(mapCreditCostForApi(updated)));
  });
}
