import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireVendorAdminOrPlatformAdmin } from "@/helpers/vendor-membership";
import { deleteVendorLogoIfOwned } from "@/lib/blob";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { vendorLogoCleanupRequestSchema } from "@/schemas/vendor-logo-upload.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Vendor ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const cleanupResultSchema = z
  .object({
    ok: z.literal(true),
  })
  .openapi("VendorLogoCleanupResult");

const route = createRoute({
  method: "post",
  path: "/{id}/files/cleanup",
  description: [
    "Best-effort delete of a prior vendor logo blob when the URL is",
    "owned by this vendor (`vendors/{id}/logos/…`).",
    "Foreign, legacy, or invalid URLs are ignored. Vendor admins or platform admins only.",
  ].join(" "),
  tags: ["Vendors"],
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: vendorLogoCleanupRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      cleanupResultSchema,
      "Cleanup attempted (owned logos deleted; others ignored)",
      {
        data: { ok: true },
        meta: {
          timestamp: "2026-02-16T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You must be a vendor admin or platform admin",
    ),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { url } = c.req.valid("json");

    await requireVendorAdminOrPlatformAdmin(c.var.authContext, id);

    await deleteVendorLogoIfOwned(url, id);

    return ok(c, cleanupResultSchema.parse({ ok: true }));
  });
}
