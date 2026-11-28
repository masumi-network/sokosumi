import { createRoute } from "@hono/zod-openapi";
import { normalizeMasumiPaymentUnit } from "@sokosumi/masumi";
import { convertCreditsToCents } from "@sokosumi/utils";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { createRate } from "@/lib/agent-catalog/admin";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
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
    requireAdminAuthContext(c.var.authContext);
    const body = c.req.valid("json");
    const unit = normalizeMasumiPaymentUnit(body.unit);

    const createdRecord = await createRate(
      c.var.networkScope,
      unit,
      convertCreditsToCents(body.creditsPerUnit),
    );

    return created(
      c,
      creditCostSchema.parse(mapCreditCostForApi(createdRecord)),
    );
  });
}
