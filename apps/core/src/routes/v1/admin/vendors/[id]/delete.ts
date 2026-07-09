import { createRoute, z } from "@hono/zod-openapi";
import { VendorGrantStatus } from "@sokosumi/database";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Vendor ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}",
  operationId: "deleteAdminVendor",
  description:
    "Delete a vendor (admin only). Returns 409 when coworkers reference the vendor or pending grants exist.",
  tags: ["Admin"],
  request: {
    params,
  },
  responses: {
    204: {
      description: "Vendor deleted",
    },
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - vendor missing"),
    409: jsonErrorResponse(
      "Conflict - vendor is referenced by coworkers or pending grants",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const vendor = await prisma.vendor.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!vendor) {
      throw notFound("Vendor not found");
    }

    const [coworkerCount, pendingGrantCount] = await Promise.all([
      prisma.coworker.count({
        where: { vendorId: id },
      }),
      prisma.vendorGrant.count({
        where: {
          vendorId: id,
          status: VendorGrantStatus.PENDING,
        },
      }),
    ]);

    if (coworkerCount > 0) {
      throw conflict("Cannot delete vendor while coworkers are assigned to it");
    }

    if (pendingGrantCount > 0) {
      throw conflict("Cannot delete vendor while pending grants exist");
    }

    await prisma.vendor.delete({
      where: { id },
    });

    return c.body(null, 204);
  });
}
