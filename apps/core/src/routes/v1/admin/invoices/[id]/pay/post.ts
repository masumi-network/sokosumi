import { createRoute, z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { invoiceSummarySchema } from "@/schemas/invoice.schema";
import { invoiceAdminService } from "@/services/invoice-admin.service";

import { mapInvoiceError } from "../../helpers.js";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Stripe invoice ID",
    example: "in_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/pay",
  operationId: "markAdminInvoicePaid",
  description:
    "Mark an admin invoice as paid out of band and grant the credits immediately (admin only). Granting is idempotent against the invoice.paid webhook.",
  tags: ["Admin"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(invoiceSummarySchema, "The paid admin invoice", {
      data: {
        invoiceId: "in_123",
        targetType: "organization",
        targetId: "org_123",
        targetName: "Acme",
        credits: 100,
        ttlDays: null,
        currency: "eur",
        amountDue: 12000,
        status: "paid",
        dashboardUrl: "https://dashboard.stripe.com/acct_123/invoices/in_123",
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    400: jsonErrorResponse(
      "Bad Request - not an admin invoice, or credits were not granted",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - invoice missing"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const summary = await invoiceAdminService
      .markInvoicePaid(id)
      .catch(mapInvoiceError);

    if (!summary) {
      throw notFound("Admin invoice not found", {
        kind: CORE_API_ERROR_KINDS.INVOICE_NOT_FOUND,
      });
    }

    return ok(c, invoiceSummarySchema.parse(summary));
  });
}
