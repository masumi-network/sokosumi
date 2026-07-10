import { createRoute, z } from "@hono/zod-openapi";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isSlugUniqueConstraintError } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import { mapVendor, vendorLogoPatchData } from "@/helpers/vendor";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  patchVendorRequestSchema,
  vendorSchema,
} from "@/schemas/vendor.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Vendor ID",
    example: "01960001-0001-7001-8001-000000000001",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "patchAdminVendor",
  description: "Update a vendor (admin only).",
  tags: ["Admin"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: patchVendorRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(vendorSchema, "The updated vendor"),
    400: jsonErrorResponse("Bad Request - validation failed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - vendor missing"),
    409: jsonErrorResponse("Conflict - vendor slug already exists"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const existingVendor = await prisma.vendor.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existingVendor) {
      throw notFound("Vendor not found");
    }

    try {
      const vendor = await prisma.vendor.update({
        where: { id },
        data: {
          name: body.name,
          slug: body.slug,
          ...vendorLogoPatchData(body.logos),
        },
      });

      return ok(c, mapVendor(vendor));
    } catch (error) {
      if (isSlugUniqueConstraintError(error)) {
        throw conflict(
          "Vendor slug already exists. Please choose a different slug.",
        );
      }

      throw error;
    }
  });
}
