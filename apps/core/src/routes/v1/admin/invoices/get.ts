import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  invoiceListSchema,
  listInvoicesQuerySchema,
} from "@/schemas/invoice.schema";
import { invoiceAdminService } from "@/services/invoice-admin.service";

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminInvoices",
  description:
    "List admin invoices, most recent first (admin only). Defaults to unfinished (draft + open) invoices.",
  tags: ["Admin"],
  request: {
    query: listInvoicesQuerySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      invoiceListSchema,
      "Admin invoices matching the filter",
      {
        data: [
          {
            invoiceId: "in_123",
            targetType: "organization",
            targetName: "Acme",
            credits: 100,
            ttlDays: null,
            currency: "eur",
            amountDue: 12000,
            status: "open",
            createdAt: 1736294400000,
            dashboardUrl:
              "https://dashboard.stripe.com/acct_123/invoices/in_123",
          },
        ],
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { status, recipientType, recipientId, limit } = c.req.valid("query");

    const invoices = await invoiceAdminService.listInvoices({
      status,
      recipient:
        recipientType && recipientId
          ? { targetType: recipientType, targetId: recipientId }
          : null,
      limit,
    });

    return ok(c, invoiceListSchema.parse(invoices));
  });
}
