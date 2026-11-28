import { createRoute, z } from "@hono/zod-openapi";
import { convertCreditsToCents } from "@sokosumi/utils";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { updateRate } from "@/lib/agent-catalog/admin";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
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
    requireAdminAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const updated = await updateRate(
      c.var.networkScope,
      id,
      convertCreditsToCents(body.creditsPerUnit),
    );

    return ok(c, creditCostSchema.parse(mapCreditCostForApi(updated)));
  });
}
