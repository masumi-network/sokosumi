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

function isPrismaRecordNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2025"
  );
}

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "clxx123",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}",
  description: "Delete a credit cost (admin only)",
  tags: ["Credit Costs"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(creditCostSchema, "Delete credit cost"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireAdminAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    try {
      const deleted = await prisma.creditCost.delete({
        where: { id },
      });
      return ok(c, creditCostSchema.parse(mapCreditCostForApi(deleted)));
    } catch (error) {
      if (isPrismaRecordNotFoundError(error)) {
        throw notFound("Credit cost not found");
      }
      throw error;
    }
  });
}
