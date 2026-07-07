import { createRoute, z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
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
  method: "delete",
  path: "/{id}",
  operationId: "deleteAdminInvoice",
  description:
    "Delete or void an admin invoice (admin only). Draft invoices are permanently deleted; open invoices are voided.",
  tags: ["Admin"],
  request: {
    params,
  },
  responses: {
    204: {
      description: "Admin invoice deleted or voided",
    },
    400: jsonErrorResponse(
      "Bad Request - not an admin invoice, or invoice cannot be deleted",
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

    const deleted = await invoiceAdminService
      .deleteInvoice(id)
      .catch(mapInvoiceError);

    if (deleted === null) {
      throw notFound("Admin invoice not found", {
        kind: CORE_API_ERROR_KINDS.INVOICE_NOT_FOUND,
      });
    }

    return c.body(null, 204);
  });
}
