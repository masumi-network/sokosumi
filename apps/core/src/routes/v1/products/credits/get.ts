import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { creditPriceOptionListSchema } from "@/schemas/invoice.schema";
import { invoiceAdminService } from "@/services/invoice-admin.service";

const route = createRoute({
  method: "get",
  path: "/credits",
  operationId: "listCreditPrices",
  description:
    "List the active one-time credit prices configured on the credit product, sorted by currency then amount per credit.",
  tags: ["Products"],
  responses: {
    200: jsonSuccessResponse(
      creditPriceOptionListSchema,
      "Active credit prices, sorted by currency then amount per credit",
      {
        data: [
          {
            id: "price_123",
            amountPerCredit: 120,
            currency: "eur",
            nickname: "Standard",
          },
        ],
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireUserContext(c.var.authContext);

    const prices = await invoiceAdminService.listPrices();

    return ok(c, creditPriceOptionListSchema.parse(prices));
  });
}
