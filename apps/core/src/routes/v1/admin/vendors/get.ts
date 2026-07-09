import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapVendor } from "@/helpers/vendor";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { vendorSchema } from "@/schemas/vendor.schema";

const vendorListSchema = z.array(vendorSchema).openapi("VendorList");

const route = createRoute({
  method: "get",
  path: "/",
  operationId: "listAdminVendors",
  description: "List all vendors (admin only).",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(vendorListSchema, "List of vendors", {
      data: [
        {
          id: "01960001-0001-7001-8001-000000000001",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          name: "Service Plan",
          slug: "service-plan",
          logo: "/images/logos/serviceplan-logo.png",
        },
      ],
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const vendors = await prisma.vendor.findMany({
      orderBy: [{ name: "asc" }, { slug: "asc" }],
    });

    return ok(c, vendorListSchema.parse(vendors.map(mapVendor)));
  });
}
