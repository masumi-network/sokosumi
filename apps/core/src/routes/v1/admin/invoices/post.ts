import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  createInvoiceSchema,
  invoiceSummarySchema,
} from "@/schemas/invoice.schema";
import { invoiceAdminService } from "@/services/invoice-admin.service";

import { mapInvoiceError } from "./helpers.js";

const route = createRoute({
  method: "post",
  path: "/",
  operationId: "createAdminInvoice",
  description:
    "Create (and finalize) a one-time admin invoice for a user or organization (admin only). A free grant applies the support coupon, finalizes paid, and grants the credits immediately.",
  tags: ["Admin"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createInvoiceSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      invoiceSummarySchema,
      "The created admin invoice",
      {
        data: {
          invoiceId: "in_123",
          targetType: "organization",
          targetId: "org_123",
          targetName: "Acme",
          credits: 100,
          ttlDays: null,
          currency: "eur",
          amountDue: 12000,
          status: "open",
          dashboardUrl: "https://dashboard.stripe.com/acct_123/invoices/in_123",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request - validation failed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { targetType, targetId, credits, ttlDays, priceId, markFree } =
      c.req.valid("json");

    const summary = await invoiceAdminService
      .createInvoice({
        target: { targetType, targetId },
        credits,
        ttlDays,
        priceId,
        markFree,
      })
      .catch(mapInvoiceError);

    return ok(c, invoiceSummarySchema.parse(summary));
  });
}
