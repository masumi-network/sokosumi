import { createRoute, z } from "@hono/zod-openapi";
import { convertCreditsToCents } from "@sokosumi/database/helpers";

import { conflict, notFound } from "@/helpers/error";
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
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    await requireAdminAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.creditCost.findUnique({ where: { id } });
      if (!current) {
        throw notFound("Credit cost not found");
      }

      if (body.unit !== undefined) {
        const existingWithUnit = await tx.creditCost.findFirst({
          where: {
            unit: body.unit,
            id: { not: id },
          },
        });
        if (existingWithUnit) {
          throw conflict("Unit already exists");
        }
      }

      const data: { unit?: string; centsPerUnit?: bigint } = {};
      if (body.unit !== undefined) {
        data.unit = body.unit;
      }
      if (body.creditsPerUnit !== undefined) {
        data.centsPerUnit = convertCreditsToCents(body.creditsPerUnit);
      }

      return tx.creditCost.update({
        where: { id },
        data,
      });
    });

    return ok(c, creditCostSchema.parse(mapCreditCostForApi(updated)));
  });
}
