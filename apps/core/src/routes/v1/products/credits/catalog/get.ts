import { createRoute } from "@hono/zod-openapi";
import type { CreditTopUpLookupKey } from "@sokosumi/utils";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  creditTopUpCatalogQuerySchema,
  creditTopUpLookupKeySchema,
  creditTopUpPriceCatalogSchema,
} from "@/schemas/billing.schema";
import { stripeBillingService } from "@/services/stripe-billing.service";

const route = createRoute({
  method: "get",
  path: "/credits/catalog",
  operationId: "getCreditTopUpPriceCatalog",
  description:
    "Tiered credit top-up price catalog keyed by Stripe lookup keys. Pass extra lookup keys (comma-separated) to include optional tiers such as zero-margin pricing.",
  tags: ["Products"],
  request: {
    query: creditTopUpCatalogQuerySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      creditTopUpPriceCatalogSchema,
      "Credit top-up prices keyed by lookup key",
      {
        data: {
          credit_20_margin: {
            id: "price_123",
            amountPerCredit: 120,
            currency: "eur",
          },
        },
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

function parseExtraLookupKeys(
  rawValue: string | undefined,
): CreditTopUpLookupKey[] {
  if (!rawValue?.trim()) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => creditTopUpLookupKeySchema.parse(value));
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireUserContext(c.var.authContext);
    const { extraLookupKeys } = c.req.valid("query");

    const catalog = await stripeBillingService.getCreditTopUpPriceCatalog(
      parseExtraLookupKeys(extraLookupKeys),
    );

    return ok(c, creditTopUpPriceCatalogSchema.parse(catalog));
  });
}
