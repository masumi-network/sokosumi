import { createRoute, z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { invoiceSummarySchema } from "@/schemas/invoice.schema";
import { invoiceAdminService } from "@/services/invoice-admin.service";

import { mapInvoiceError } from "../helpers.js";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Stripe invoice ID",
    example: "in_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  operationId: "getAdminInvoice",
  description:
    "Fetch a single admin invoice (admin only). 404 when the invoice does not exist or is not an admin invoice.",
  tags: ["Admin"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(invoiceSummarySchema, "The admin invoice", {
      data: {
        invoiceId: "in_123",
        targetType: "user",
        targetId: "user_123",
        targetName: "Ada Lovelace",
        credits: 100,
        ttlDays: 30,
        currency: "eur",
        amountDue: 12000,
        status: "open",
        dashboardUrl: "https://dashboard.stripe.com/acct_123/invoices/in_123",
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse(
      "Not Found - invoice missing or not an admin invoice",
    ),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const summary = await invoiceAdminService
      .getInvoice(id)
      .catch(mapInvoiceError);

    if (!summary) {
      throw notFound("Admin invoice not found", {
        kind: CORE_API_ERROR_KINDS.INVOICE_NOT_FOUND,
      });
    }

    return ok(c, invoiceSummarySchema.parse(summary));
  });
}
