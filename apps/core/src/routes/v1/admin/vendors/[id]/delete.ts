import { createRoute, z } from "@hono/zod-openapi";

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
    "Delete a vendor (admin only). Returns 409 when coworkers reference the vendor.",
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
    409: jsonErrorResponse("Conflict - vendor is referenced by coworkers"),
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

    const coworkerCount = await prisma.coworker.count({
      where: { vendorId: id },
    });

    if (coworkerCount > 0) {
      throw conflict("Cannot delete vendor while coworkers are assigned to it");
    }

    await prisma.vendor.delete({
      where: { id },
    });

    return c.body(null, 204);
  });
}
