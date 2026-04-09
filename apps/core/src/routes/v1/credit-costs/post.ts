import { createRoute } from "@hono/zod-openapi";
import { convertCreditsToCents } from "@sokosumi/utils";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/routes/v1/coworkers/admin-guard";
import {
  createCreditCostRequestSchema,
  creditCostSchema,
  mapCreditCostForApi,
} from "@/schemas/credit-cost.schema";

const route = createRoute({
  method: "post",
  path: "/",
  description: "Create a credit cost (admin only)",
  tags: ["Credit Costs"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createCreditCostRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(creditCostSchema, "Create credit cost"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    await requireAdminAuthContext(c.var.authContext);
    const body = c.req.valid("json");

    const createdRecord = await prisma.$transaction(async (tx) => {
      const existing = await tx.creditCost.findUnique({
        where: { unit: body.unit },
      });
      if (existing) {
        throw conflict("Unit already exists");
      }

      const centsPerUnit = convertCreditsToCents(body.creditsPerUnit);
      return tx.creditCost.create({
        data: {
          unit: body.unit,
          centsPerUnit,
        },
      });
    });

    return created(
      c,
      creditCostSchema.parse(mapCreditCostForApi(createdRecord)),
    );
  });
}
